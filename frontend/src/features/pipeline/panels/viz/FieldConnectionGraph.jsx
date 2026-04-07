/**
 * FieldConnectionGraph — ReactFlow field connection visualization.
 *
 * References:
 *   - @xyflow/react: production node-edge graph (Stripe, Vercel)
 *   - dagre: hierarchical LR layout algorithm
 *   - Figma connectors: bezier curves, confidence thickness, hover tooltips
 *
 * Covers: V2 (field connection animation), V8 (data source glow from template clicks)
 *
 * Template fields (left) ←→ DB columns (right)
 * Edge style: thick=high confidence, dashed=low, glow=highlighted
 * Line-drawing animation on mount via stroke-dashoffset.
 */
import React, { useMemo, useCallback, useEffect, useState, useRef } from 'react'
import { Box, Typography, Chip } from '@mui/material'
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  getBezierPath,
  Handle,
  Position,
  reconnectEdge,
} from '@xyflow/react'
import dagre from 'dagre'
import '@xyflow/react/dist/style.css'
import usePipelineStore from '@/stores/pipeline'
import { humanizeToken, humanizeColumn } from '../../utils'

// ── Dagre auto-layout ──
function getLayoutedElements(nodes, edges) {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 10, ranksep: 160, marginx: 12, marginy: 12 })
  nodes.forEach(n => g.setNode(n.id, { width: 140, height: 34 }))
  edges.forEach(e => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return {
    nodes: nodes.map(n => {
      const pos = g.node(n.id)
      return { ...n, position: { x: pos.x - 70, y: pos.y - 17 } }
    }),
    edges,
  }
}

// ── Confidence color helper ──
function confColor(conf) {
  if (conf >= 0.8) return '#4caf50'
  if (conf >= 0.5) return '#ff9800'
  return '#f44336'
}

// ── Custom Node: Template Field (left side) ──
function TemplateFieldNode({ data }) {
  return (
    <Box
      sx={{
        px: 1.5, py: 0.5,
        borderRadius: 1.5,
        border: '2px solid',
        borderColor: data.color,
        bgcolor: `${data.color}12`,
        fontSize: '0.72rem',
        fontWeight: data.isGlowing ? 700 : 500,
        color: data.isDimmed ? '#ccc' : '#333',
        opacity: data.isDimmed ? 0.15 : 1,
        transition: 'all 0.25s ease',
        cursor: 'pointer',
        position: 'relative',
        minWidth: 110,
        textAlign: 'center',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        ...(data.isGlowing && {
          boxShadow: `0 0 14px 4px ${data.color}55`,
          borderWidth: 2.5,
          fontWeight: 700,
        }),
        '&:hover': {
          borderColor: data.color,
          bgcolor: `${data.color}22`,
          transform: 'scale(1.02)',
        },
      }}
    >
      {data.label}
      {data.isUnresolved && (
        <Box
          sx={{
            position: 'absolute', top: -3, right: -3,
            width: 7, height: 7, borderRadius: '50%',
            bgcolor: '#f44336',
            animation: 'unmappedPulse 2s infinite',
            '@keyframes unmappedPulse': {
              '0%, 100%': { opacity: 0.4, transform: 'scale(1)' },
              '50%': { opacity: 1, transform: 'scale(1.3)' },
            },
          }}
        />
      )}
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 6, height: 6 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 6, height: 6 }} />
    </Box>
  )
}

// ── Custom Node: DB Column (right side) ──
function DbColumnNode({ data }) {
  return (
    <Box
      sx={{
        px: 1.5, py: 0.5,
        borderRadius: 1.5,
        border: '1.5px solid',
        borderColor: data.isGlowing ? '#1565c0' : '#e0e0e0',
        bgcolor: data.isGlowing ? '#e3f2fd' : '#fafafa',
        fontSize: '0.72rem',
        fontWeight: data.isGlowing ? 600 : 400,
        color: data.isDimmed ? '#ccc' : '#666',
        opacity: data.isDimmed ? 0.15 : 1,
        transition: 'all 0.25s ease',
        cursor: 'pointer',
        minWidth: 110,
        textAlign: 'center',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        ...(data.isGlowing && {
          boxShadow: '0 0 12px 4px rgba(21, 101, 192, 0.35)',
        }),
        '&:hover': {
          borderColor: '#90caf9',
          bgcolor: '#e3f2fd',
        },
      }}
    >
      {data.label}
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 6, height: 6 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 6, height: 6 }} />
    </Box>
  )
}

// ── Custom Edge: confidence-styled with tooltip + line-drawing animation ──
function ConfidenceEdge({ sourceX, sourceY, targetX, targetY, data, style }) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY })
  const [hovered, setHovered] = useState(false)
  const [pathLength, setPathLength] = useState(0)
  const pathRef = useRef(null)

  const conf = data?.confidence ?? 0.5
  const color = data?.color || '#90caf9'
  const isGlowing = data?.isGlowing
  const isDimmed = data?.isDimmed

  const strokeWidth = isGlowing ? 3.5 : conf >= 0.8 ? 2.5 : 1.5
  const dashArray = conf >= 0.8 ? 'none' : '6,3'
  const opacity = isDimmed ? 0.06 : isGlowing ? 1 : 0.6

  useEffect(() => {
    if (pathRef.current) setPathLength(pathRef.current.getTotalLength())
  }, [path])

  const tooltip = data?.sourceLabel && data?.targetLabel
    ? `${data.sourceLabel} ← ${data.targetLabel} (${Math.round(conf * 100)}%)`
    : `${Math.round(conf * 100)}% confidence`

  return (
    <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {/* Animated edge path */}
      <path
        ref={pathRef}
        d={path}
        fill="none"
        stroke={isGlowing ? color : confColor(conf)}
        strokeWidth={strokeWidth}
        strokeDasharray={dashArray !== 'none' ? dashArray : `${pathLength || 500}`}
        strokeDashoffset={0}
        opacity={opacity}
        style={{
          transition: 'stroke-width 0.2s, opacity 0.2s',
          filter: isGlowing ? `drop-shadow(0 0 6px ${color})` : 'none',
          animation: pathLength ? 'edgeDraw 0.7s ease-out forwards' : 'none',
          ...style,
        }}
      />
      {/* Wide invisible hit area */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={16} style={{ cursor: 'pointer' }} />
      {/* Hover tooltip via foreignObject */}
      {hovered && (
        <foreignObject
          x={(sourceX + targetX) / 2 - 90}
          y={(sourceY + targetY) / 2 - 30}
          width={180}
          height={36}
          style={{ pointerEvents: 'none', overflow: 'visible' }}
        >
          <div
            style={{
              background: '#fff',
              border: '1px solid #e0e0e0',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: '0.68rem',
              fontWeight: 500,
              color: '#333',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              textAlign: 'center',
              whiteSpace: 'nowrap',
            }}
          >
            {tooltip}
          </div>
        </foreignObject>
      )}
    </g>
  )
}

const nodeTypes = { templateField: TemplateFieldNode, dbColumn: DbColumnNode }
const edgeTypes = { confidence: ConfidenceEdge }

// ── Main Component ──
export default function FieldConnectionGraph({ compact = true }) {
  const template = usePipelineStore(s => s.pipelineState.data.template)
  const mapping = usePipelineStore(s => s.pipelineState.data.mapping)
  const highlightedField = usePipelineStore(s => s.highlightedField)
  const setHighlightedField = usePipelineStore(s => s.setHighlightedField)
  const setActivePanel = usePipelineStore(s => s.setActivePanel)
  const getTokenColor = usePipelineStore(s => s.getTokenColor)

  const tokens = template?.tokens || []
  const mappingData = mapping?.mapping || {}
  const confidence = mapping?.confidence || {}

  // Build nodes + edges from store data
  const { layoutNodes, layoutEdges, stats } = useMemo(() => {
    if (!tokens.length || !Object.keys(mappingData).length) {
      return { layoutNodes: [], layoutEdges: [], stats: { total: 0, connected: 0, unresolved: 0 } }
    }

    const isHighlighting = !!highlightedField
    const nodes = []
    const edges = []
    const dbColSet = new Set()
    let connected = 0
    let unresolved = 0

    // Collect unique DB columns
    Object.values(mappingData).forEach(v => {
      if (v && v !== 'UNRESOLVED' && !v.startsWith('RESHAPE:') && !v.startsWith('COMPUTED:')) {
        dbColSet.add(v)
      }
    })

    const maxNodes = compact ? 12 : 20
    const visibleTokens = tokens.slice(0, maxNodes)
    const visibleCols = [...dbColSet].slice(0, maxNodes)

    // Left nodes: template fields
    visibleTokens.forEach(t => {
      const color = getTokenColor(t)
      const isUnmapped = !mappingData[t] || mappingData[t] === 'UNRESOLVED'
      if (isUnmapped) unresolved++
      const isGlowing = highlightedField === t
      const isDimmed = isHighlighting && !isGlowing

      nodes.push({
        id: `tf-${t}`,
        type: 'templateField',
        position: { x: 0, y: 0 },
        data: { label: humanizeToken(t).slice(0, 18), color, isUnresolved: isUnmapped, isGlowing, isDimmed, tokenId: t },
      })
    })

    // Right nodes: DB columns
    visibleCols.forEach(col => {
      const isGlowing = isHighlighting && Object.entries(mappingData).some(
        ([k, v]) => v === col && k === highlightedField
      )
      const isDimmed = isHighlighting && !isGlowing

      nodes.push({
        id: `db-${col}`,
        type: 'dbColumn',
        position: { x: 0, y: 0 },
        data: { label: humanizeColumn(col).slice(0, 18), isGlowing, isDimmed },
      })
    })

    // Edges: field → column
    visibleTokens.forEach(t => {
      const target = mappingData[t]
      if (!target || target === 'UNRESOLVED' || target.startsWith('RESHAPE:') || target.startsWith('COMPUTED:')) return
      if (!visibleCols.includes(target)) return

      const color = getTokenColor(t)
      const conf = confidence[t] ?? 0.5
      const isGlowing = highlightedField === t
      const isDimmed = isHighlighting && !isGlowing

      edges.push({
        id: `e-${t}-${target}`,
        source: `tf-${t}`,
        target: `db-${target}`,
        type: 'confidence',
        data: { confidence: conf, color, isGlowing, isDimmed, sourceLabel: humanizeToken(t), targetLabel: humanizeColumn(target) },
      })
      connected++
    })

    const laid = getLayoutedElements(nodes, edges)
    return {
      layoutNodes: laid.nodes,
      layoutEdges: laid.edges,
      stats: { total: tokens.length, connected, unresolved },
    }
  }, [tokens, mappingData, confidence, getTokenColor, highlightedField, compact])

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges)

  useEffect(() => {
    setNodes(layoutNodes)
    setEdges(layoutEdges)
  }, [layoutNodes, layoutEdges, setNodes, setEdges])

  // Click node → highlight field (V8: cross-panel glow)
  const onNodeClick = useCallback((_e, node) => {
    const tokenId = node.data?.tokenId
    if (tokenId) {
      setHighlightedField(highlightedField === tokenId ? null : tokenId)
    }
  }, [setHighlightedField, highlightedField])

  const onReconnect = useCallback((oldEdge, newConnection) => {
    setEdges(eds => reconnectEdge(oldEdge, newConnection, eds))
  }, [setEdges])

  // Click background → clear highlight
  const onPaneClick = useCallback(() => setHighlightedField(null), [setHighlightedField])

  if (!tokens.length || !Object.keys(mappingData).length) return null

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        '&:hover': { borderColor: 'primary.light' },
        transition: 'border-color 0.2s',
        '@keyframes edgeDraw': {
          from: { strokeDashoffset: 500 },
          to: { strokeDashoffset: 0 },
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 1.5, py: 0.75,
          borderBottom: 1, borderColor: 'divider',
          display: 'flex', alignItems: 'center', gap: 1,
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
        }}
        onClick={() => setActivePanel('mappings')}
      >
        <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>
          Field Connections
        </Typography>
        <Chip label={`${stats.connected}/${stats.total}`} size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: '0.6rem' }} />
        {stats.unresolved > 0 && (
          <Chip label={`${stats.unresolved} unmapped`} size="small" color="warning" variant="outlined" sx={{ height: 20, fontSize: '0.6rem' }} />
        )}
      </Box>

      {/* Graph */}
      <Box sx={{ height: compact ? 200 : 400 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onReconnect={onReconnect}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={compact ? 1 : 1.5}
          nodesDraggable={!compact}
          nodesConnectable={!compact}
          elementsSelectable
          panOnDrag={!compact}
          zoomOnScroll={!compact}
          preventScrolling={compact}
          proOptions={{ hideAttribution: true }}
        >
          {!compact && <Controls showInteractive={false} />}
          <Background variant="dots" gap={16} size={0.5} color="#e0e0e0" />
        </ReactFlow>
      </Box>
    </Box>
  )
}
