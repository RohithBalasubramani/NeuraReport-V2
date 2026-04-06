/**
 * FieldConnectionGraph (#2 + #8) — React Flow-based field connection visualization.
 * Template fields (left) <-> DB columns (right), edges connecting them.
 * Uses @xyflow/react with dagre auto-layout for production-grade graph rendering.
 * Thick = strong confidence, dotted = weak, glow = highlighted field.
 */
import React, { useMemo, useCallback, useEffect, useState } from 'react'
import { Box, Typography } from '@mui/material'
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  getBezierPath,
  BaseEdge,
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
  g.setGraph({ rankdir: 'LR', nodesep: 8, ranksep: 150, marginx: 10, marginy: 10 })

  nodes.forEach((n) => g.setNode(n.id, { width: 140, height: 32 }))
  edges.forEach((e) => g.setEdge(e.source, e.target))
  dagre.layout(g)

  return {
    nodes: nodes.map((n) => {
      const pos = g.node(n.id)
      return { ...n, position: { x: pos.x - 70, y: pos.y - 16 } }
    }),
    edges,
  }
}

// ── Custom Nodes ──
function TemplateFieldNode({ data, selected }) {
  const isUnresolved = data.isUnresolved
  const isGlowing = data.isGlowing
  const isDimmed = data.isDimmed

  return (
    <Box
      sx={{
        px: 1.5, py: 0.5,
        borderRadius: 1,
        border: '1.5px solid',
        borderColor: data.color,
        bgcolor: `${data.color}15`,
        fontSize: '0.75rem',
        fontWeight: isGlowing ? 700 : 500,
        color: isDimmed ? '#ccc' : '#333',
        opacity: isDimmed ? 0.15 : 1,
        transition: 'all 0.3s ease',
        cursor: 'pointer',
        position: 'relative',
        minWidth: 110,
        textAlign: 'center',
        ...(isGlowing && {
          boxShadow: `0 0 12px 4px ${data.color}66`,
          borderWidth: 2,
        }),
      }}
    >
      {data.label}
      {isUnresolved && (
        <Box
          sx={{
            position: 'absolute', top: -4, right: -4,
            width: 8, height: 8, borderRadius: '50%',
            bgcolor: '#f44336',
            animation: 'pulse 2s infinite',
            '@keyframes pulse': {
              '0%, 100%': { opacity: 0.4 },
              '50%': { opacity: 1 },
            },
          }}
        />
      )}
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 6, height: 6 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 6, height: 6 }} />
    </Box>
  )
}

function DbColumnNode({ data }) {
  const isGlowing = data.isGlowing
  const isDimmed = data.isDimmed

  return (
    <Box
      sx={{
        px: 1.5, py: 0.5,
        borderRadius: 1,
        border: '1.5px solid',
        borderColor: isGlowing ? '#1976D2' : '#e0e0e0',
        bgcolor: isGlowing ? '#E3F2FD' : '#f5f5f5',
        fontSize: '0.75rem',
        fontWeight: isGlowing ? 600 : 400,
        color: isDimmed ? '#ccc' : '#666',
        opacity: isDimmed ? 0.15 : 1,
        transition: 'all 0.3s ease',
        cursor: 'pointer',
        minWidth: 110,
        textAlign: 'center',
        ...(isGlowing && {
          boxShadow: '0 0 12px 4px rgba(25, 118, 210, 0.4)',
        }),
      }}
    >
      {data.label}
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 6, height: 6 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 6, height: 6 }} />
    </Box>
  )
}

// ── Custom Edge with confidence styling ──
function ConfidenceEdge({ id, sourceX, sourceY, targetX, targetY, data, style }) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY })
  const conf = data?.confidence ?? 0.5
  const color = data?.color || '#90CAF9'
  const isGlowing = data?.isGlowing
  const isDimmed = data?.isDimmed

  const strokeWidth = isGlowing ? 4 : conf >= 0.8 ? 2.5 : 1.5
  const dashArray = conf >= 0.8 ? 'none' : '6,3'
  const opacity = isDimmed ? 0.08 : isGlowing ? 1 : 0.65

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: color,
          strokeWidth,
          strokeDasharray: dashArray,
          opacity,
          transition: 'all 0.3s ease',
          filter: isGlowing ? `drop-shadow(0 0 6px ${color})` : 'none',
          ...style,
        }}
      />
      {/* Wider invisible hit target */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={14} style={{ cursor: 'pointer' }} />
    </>
  )
}

const nodeTypes = { templateField: TemplateFieldNode, dbColumn: DbColumnNode }
const edgeTypes = { confidence: ConfidenceEdge }

export default function FieldConnectionGraph({ compact = true }) {
  const template = usePipelineStore((s) => s.pipelineState.data.template)
  const mapping = usePipelineStore((s) => s.pipelineState.data.mapping)
  const highlightedField = usePipelineStore((s) => s.highlightedField)
  const setHighlightedField = usePipelineStore((s) => s.setHighlightedField)
  const setActivePanel = usePipelineStore((s) => s.setActivePanel)
  const getTokenColor = usePipelineStore((s) => s.getTokenColor)

  const tokens = template?.tokens || []
  const mappingData = mapping?.mapping || {}
  const confidence = mapping?.confidence || {}

  // Build React Flow nodes + edges
  const { initialNodes, initialEdges, connectedCount } = useMemo(() => {
    if (tokens.length === 0 || Object.keys(mappingData).length === 0) {
      return { initialNodes: [], initialEdges: [], connectedCount: 0 }
    }

    const isHighlighting = !!highlightedField
    const nodes = []
    const edges = []
    const dbColSet = new Set()

    // Collect unique DB columns
    Object.values(mappingData).forEach((v) => {
      if (v && v !== 'UNRESOLVED' && !v.startsWith('RESHAPE:') && !v.startsWith('COMPUTED:')) {
        dbColSet.add(v)
      }
    })

    // Left nodes (template fields, max 15)
    tokens.slice(0, 15).forEach((t) => {
      const color = getTokenColor(t)
      const isUnresolved = !mappingData[t] || mappingData[t] === 'UNRESOLVED'
      const isGlowing = highlightedField === t
      const isDimmed = isHighlighting && !isGlowing

      nodes.push({
        id: `tf-${t}`,
        type: 'templateField',
        position: { x: 0, y: 0 },
        data: {
          label: humanizeToken(t).slice(0, 16),
          color,
          isUnresolved,
          isGlowing,
          isDimmed,
          tokenId: t,
        },
      })
    })

    // Right nodes (DB columns, max 15)
    ;[...dbColSet].slice(0, 15).forEach((col) => {
      const isGlowing = isHighlighting && Object.entries(mappingData).some(
        ([k, v]) => v === col && k === highlightedField
      )
      const isDimmed = isHighlighting && !isGlowing

      nodes.push({
        id: `db-${col}`,
        type: 'dbColumn',
        position: { x: 0, y: 0 },
        data: {
          label: humanizeColumn(col).slice(0, 16),
          isGlowing,
          isDimmed,
        },
      })
    })

    // Edges
    let connected = 0
    tokens.slice(0, 15).forEach((t) => {
      const target = mappingData[t]
      if (!target || target === 'UNRESOLVED' || target.startsWith('RESHAPE:') || target.startsWith('COMPUTED:')) return
      if (![...dbColSet].slice(0, 15).includes(target)) return

      const color = getTokenColor(t)
      const conf = confidence[t] ?? 0.5
      const isGlowing = highlightedField === t
      const isDimmed = isHighlighting && !isGlowing

      edges.push({
        id: `e-${t}-${target}`,
        source: `tf-${t}`,
        target: `db-${target}`,
        type: 'confidence',
        data: { confidence: conf, color, isGlowing, isDimmed },
      })
      connected++
    })

    // Apply dagre layout
    const laid = getLayoutedElements(nodes, edges)
    return { initialNodes: laid.nodes, initialEdges: laid.edges, connectedCount: connected }
  }, [tokens, mappingData, confidence, getTokenColor, highlightedField])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Sync nodes/edges when data changes
  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges, setNodes, setEdges])

  const onNodeClick = useCallback((_event, node) => {
    const tokenId = node.data?.tokenId
    if (tokenId) setHighlightedField(tokenId)
  }, [setHighlightedField])

  const onReconnect = useCallback((oldEdge, newConnection) => {
    setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds))
  }, [setEdges])

  const onPaneClick = useCallback(() => {
    setHighlightedField(null)
  }, [setHighlightedField])

  if (tokens.length === 0 || Object.keys(mappingData).length === 0) return null

  const graphHeight = compact ? 200 : 400

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        '&:hover': { borderColor: 'primary.light' },
        transition: 'border-color 0.2s',
      }}
    >
      <Box
        sx={{
          px: 1.5, py: 0.75,
          borderBottom: 1, borderColor: 'divider',
          display: 'flex', alignItems: 'center',
          cursor: 'pointer',
        }}
        onClick={() => setActivePanel('mappings')}
      >
        <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>
          Field Connections
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {connectedCount} connected
        </Typography>
      </Box>

      <Box sx={{ height: graphHeight }}>
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
          elementsSelectable={true}
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
