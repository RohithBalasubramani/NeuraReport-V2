/**
 * LogicTab — Contract rules, data flow, and field lineage with:
 * - Mermaid (data flow graph)
 * - ReactFlow (join relationship graph)
 * - react-d3-tree (field lineage tree)
 * - View mode toggle: Rules | Flow | Joins | Lineage
 */
import React, { useState, useMemo, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import {
  Box, Card, CardContent, Chip, Collapse, Divider, Paper, Stack,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import {
  AccountTree as FlowIcon,
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  ArrowRightAlt as ArrowIcon,
  Schema as SchemaIcon,
  Timeline as LineageIcon,
  Rule as RuleIcon,
} from '@mui/icons-material'
import usePipelineStore from '@/stores/pipeline'
import { humanizeToken, humanizeColumn } from '../../utils'

// Lazy-load heavy visualization libs
const ReactFlow = lazy(() => import('@xyflow/react').then(m => ({ default: m.ReactFlow })))
const Tree = lazy(() => import('react-d3-tree').then(m => ({ default: m.default || m.Tree })))

// ── Rule Card (existing, kept as-is) ──
function RuleCard({ field, rule, onSelect }) {
  const [expanded, setExpanded] = useState(false)

  const plainText = useMemo(() => {
    if (!rule) return 'No rule defined'
    if (typeof rule === 'string') return rule
    const parts = []
    if (rule.source) parts.push(`comes from ${humanizeColumn(rule.source)}`)
    if (rule.transform) parts.push(`transformed by ${rule.transform}`)
    if (rule.aggregate) parts.push(`aggregated using ${rule.aggregate}`)
    if (rule.default != null) parts.push(`defaults to "${rule.default}"`)
    if (rule.computed) parts.push(`computed: ${rule.computed}`)
    return parts.join(', ') || JSON.stringify(rule)
  }, [rule])

  return (
    <Card
      variant="outlined"
      sx={{ '&:hover': { borderColor: 'primary.light' }, cursor: 'pointer' }}
      onClick={() => onSelect?.(field)}
    >
      <CardContent
        sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}
        onClick={(e) => { e.stopPropagation(); setExpanded(e => !e) }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
            {humanizeToken(field)}
          </Typography>
          {expanded ? <CollapseIcon sx={{ fontSize: 16 }} /> : <ExpandIcon sx={{ fontSize: 16 }} />}
        </Box>
        <Typography variant="caption" color="text.secondary">{plainText}</Typography>
      </CardContent>
      <Collapse in={expanded}>
        <Divider />
        <Box sx={{ px: 2, py: 1, bgcolor: 'grey.50' }}>
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
            <Chip
              label={rule?.source ? humanizeColumn(rule.source) : 'Source'}
              size="small" color="info" variant="outlined"
            />
            <ArrowIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
            {rule?.transform && (
              <>
                <Chip label={rule.transform} size="small" variant="outlined" />
                <ArrowIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
              </>
            )}
            <Chip label={humanizeToken(field)} size="small" color="primary" />
          </Stack>
          {rule && typeof rule === 'object' && (
            <Typography
              variant="caption" color="text.disabled"
              sx={{ mt: 1, display: 'block', fontFamily: 'monospace', fontSize: '0.65rem' }}
            >
              {JSON.stringify(rule, null, 2)}
            </Typography>
          )}
        </Box>
      </Collapse>
    </Card>
  )
}

// ── Mermaid Data Flow Graph ──
function MermaidFlowView({ rules }) {
  const containerRef = useRef(null)
  const [svg, setSvg] = useState('')

  useEffect(() => {
    if (!rules.length) return
    let cancelled = false

    // Build Mermaid definition from contract rules
    const lines = ['graph LR']
    const sources = new Set()
    const transforms = new Set()

    rules.forEach(({ field, rule }) => {
      if (!rule) return
      const target = field.replace(/[^a-zA-Z0-9_]/g, '_')
      const targetLabel = humanizeToken(field)

      if (rule.source) {
        const src = rule.source.replace(/[^a-zA-Z0-9_]/g, '_')
        const srcLabel = humanizeColumn(rule.source)
        sources.add(src)

        if (rule.transform) {
          const txId = `tx_${target}`
          lines.push(`  ${src}["${srcLabel}"] --> ${txId}["${rule.transform}"]`)
          lines.push(`  ${txId} --> ${target}["${targetLabel}"]`)
          transforms.add(txId)
        } else {
          lines.push(`  ${src}["${srcLabel}"] --> ${target}["${targetLabel}"]`)
        }
      } else if (rule.computed) {
        lines.push(`  computed_${target}(("computed")) --> ${target}["${targetLabel}"]`)
      }
    })

    // Add styling
    lines.push('')
    sources.forEach(s => lines.push(`  style ${s} fill:#e3f2fd,stroke:#2196f3`))
    transforms.forEach(t => lines.push(`  style ${t} fill:#fff3e0,stroke:#ff9800`))

    const mermaidDef = lines.join('\n')

    import('mermaid').then(mermaid => {
      if (cancelled) return
      mermaid.default.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' })
      const id = `mermaid-flow-${Date.now()}`
      mermaid.default.render(id, mermaidDef).then(({ svg: renderedSvg }) => {
        if (!cancelled) setSvg(renderedSvg)
      }).catch(() => {
        if (!cancelled) setSvg('<p style="color:red;font-size:12px">Failed to render flow diagram</p>')
      })
    })

    return () => { cancelled = true }
  }, [rules])

  if (!rules.length) {
    return <Typography variant="caption" color="text.secondary" sx={{ p: 2 }}>No rules to visualize.</Typography>
  }

  return (
    <Box
      ref={containerRef}
      sx={{ p: 2, overflow: 'auto', '& svg': { maxWidth: '100%', height: 'auto' } }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

// ── ReactFlow Join Graph ──
function JoinGraphView({ contract }) {
  const { nodes, edges } = useMemo(() => {
    const n = []
    const e = []
    const tablesSet = new Set()

    // Extract tables from contract
    const rules = contract?.contract?.fields || contract?.contract?.rules || contract?.contract?.token_rules || contract?.contract || {}
    if (typeof rules !== 'object') return { nodes: [], edges: [] }

    Object.values(rules).forEach(rule => {
      if (rule?.source) {
        const parts = rule.source.split('.')
        if (parts.length > 1) tablesSet.add(parts[0])
      }
    })

    // Extract joins
    const joins = contract?.contract?.joins || contract?.contract?.relationships || []

    const tableArr = [...tablesSet]
    tableArr.forEach((table, i) => {
      n.push({
        id: table,
        data: { label: table },
        position: { x: (i % 3) * 200, y: Math.floor(i / 3) * 100 },
        style: {
          background: '#e3f2fd', border: '1px solid #2196f3',
          borderRadius: 8, padding: 8, fontSize: 12,
        },
      })
    })

    if (Array.isArray(joins)) {
      joins.forEach((join, i) => {
        if (join.from && join.to) {
          e.push({
            id: `join-${i}`,
            source: join.from.split('.')[0],
            target: join.to.split('.')[0],
            label: join.type || 'JOIN',
            style: { stroke: '#90caf9' },
            labelStyle: { fontSize: 10 },
          })
        }
      })
    }

    return { nodes: n, edges: e }
  }, [contract])

  if (nodes.length === 0) {
    return <Typography variant="caption" color="text.secondary" sx={{ p: 2 }}>No join relationships found in contract.</Typography>
  }

  return (
    <Box sx={{ height: 250, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Suspense fallback={<Typography variant="caption" sx={{ p: 2 }}>Loading graph...</Typography>}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          nodesDraggable
          nodesConnectable={false}
          style={{ background: '#fafafa' }}
        />
      </Suspense>
    </Box>
  )
}

// ── react-d3-tree Field Lineage ──
function LineageView({ rules, selectedField, onFieldSelect }) {
  const setHighlightedField = usePipelineStore(s => s.setHighlightedField)

  // Build tree data for selected field
  const treeData = useMemo(() => {
    if (!selectedField) {
      // Show all fields as roots
      return {
        name: 'Template',
        children: rules.map(({ field, rule }) => buildFieldTree(field, rule)),
      }
    }
    const rule = rules.find(r => r.field === selectedField)
    if (!rule) return { name: humanizeToken(selectedField), children: [] }
    return buildFieldTree(rule.field, rule.rule)
  }, [rules, selectedField])

  return (
    <Box sx={{ height: 350, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Suspense fallback={<Typography variant="caption" sx={{ p: 2 }}>Loading lineage tree...</Typography>}>
        <Tree
          data={treeData}
          orientation="horizontal"
          pathFunc="step"
          translate={{ x: 50, y: 150 }}
          nodeSize={{ x: 200, y: 50 }}
          separation={{ siblings: 1, nonSiblings: 1.5 }}
          renderCustomNodeElement={({ nodeDatum }) => (
            <g>
              <rect
                width={120}
                height={28}
                x={-60}
                y={-14}
                rx={4}
                fill={nodeDatum.attributes?.type === 'source' ? '#e3f2fd'
                  : nodeDatum.attributes?.type === 'transform' ? '#fff3e0'
                  : '#e8f5e9'}
                stroke={nodeDatum.attributes?.type === 'source' ? '#2196f3'
                  : nodeDatum.attributes?.type === 'transform' ? '#ff9800'
                  : '#4caf50'}
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  if (nodeDatum.attributes?.field) {
                    onFieldSelect?.(nodeDatum.attributes.field)
                    setHighlightedField(nodeDatum.attributes.field)
                  }
                }}
              />
              <text
                x={0} y={4}
                textAnchor="middle"
                style={{ fontSize: 10, fill: '#333' }}
              >
                {nodeDatum.name.length > 18 ? nodeDatum.name.slice(0, 16) + '...' : nodeDatum.name}
              </text>
            </g>
          )}
        />
      </Suspense>
    </Box>
  )
}

function buildFieldTree(field, rule) {
  const node = {
    name: humanizeToken(field),
    attributes: { type: 'target', field },
    children: [],
  }

  if (!rule || typeof rule !== 'object') return node

  // Add transform step
  if (rule.transform || rule.aggregate) {
    const transformNode = {
      name: rule.transform || rule.aggregate,
      attributes: { type: 'transform' },
      children: [],
    }

    // Add source
    if (rule.source) {
      transformNode.children.push({
        name: humanizeColumn(rule.source),
        attributes: { type: 'source', field: rule.source },
      })
    }

    node.children.push(transformNode)
  } else if (rule.source) {
    // Direct source
    node.children.push({
      name: humanizeColumn(rule.source),
      attributes: { type: 'source', field: rule.source },
    })
  }

  if (rule.computed) {
    node.children.push({
      name: `computed: ${rule.computed}`,
      attributes: { type: 'transform' },
    })
  }

  return node
}

export default function LogicTab({ onAction }) {
  const contract = usePipelineStore(s => s.pipelineState.data.contract)
  const mapping = usePipelineStore(s => s.pipelineState.data.mapping)
  const [viewMode, setViewMode] = useState('rules') // rules | flow | joins | lineage
  const [selectedField, setSelectedField] = useState(null)

  const rules = useMemo(() => {
    if (!contract?.contract) return []
    const c = contract.contract
    if (typeof c === 'object' && !Array.isArray(c)) {
      const fields = c.fields || c.rules || c.token_rules || c
      if (typeof fields === 'object') {
        return Object.entries(fields).map(([field, rule]) => ({ field, rule }))
      }
    }
    return []
  }, [contract])

  if (rules.length === 0) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <Box sx={{ textAlign: 'center' }}>
          <FlowIcon sx={{ fontSize: 48, color: 'grey.300', mb: 1 }} />
          <Typography color="text.secondary">No report structure yet.</Typography>
          <Typography variant="caption" color="text.disabled">
            This appears after mapping is approved.
          </Typography>
        </Box>
      </Box>
    )
  }

  const computed = rules.filter(r => r.rule?.computed || r.rule?.aggregate)
  const direct = rules.filter(r => !r.rule?.computed && !r.rule?.aggregate)

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>Report Structure</Typography>
        <Chip label={`${rules.length} rules`} size="small" variant="outlined" />
        {computed.length > 0 && (
          <Chip label={`${computed.length} computed`} size="small" color="info" variant="outlined" />
        )}
      </Box>

      {/* View mode toggle */}
      <Box sx={{ px: 2, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
        <ToggleButtonGroup
          size="small"
          value={viewMode}
          exclusive
          onChange={(_, v) => v && setViewMode(v)}
          sx={{ '& .MuiToggleButton-root': { px: 1, py: 0.25, fontSize: '0.7rem' } }}
        >
          <ToggleButton value="rules">
            <RuleIcon sx={{ fontSize: 14, mr: 0.5 }} /> Rules
          </ToggleButton>
          <ToggleButton value="flow">
            <FlowIcon sx={{ fontSize: 14, mr: 0.5 }} /> Flow
          </ToggleButton>
          <ToggleButton value="joins">
            <SchemaIcon sx={{ fontSize: 14, mr: 0.5 }} /> Joins
          </ToggleButton>
          <ToggleButton value="lineage">
            <LineageIcon sx={{ fontSize: 14, mr: 0.5 }} /> Lineage
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Overview */}
      {contract?.overview && viewMode === 'rules' && (
        <Box sx={{ px: 2, py: 1, bgcolor: 'info.50', borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary">
            {typeof contract.overview === 'string' ? contract.overview : 'Contract defines how data fills your report.'}
          </Typography>
        </Box>
      )}

      {/* Content area */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {viewMode === 'rules' && (
          <Box sx={{ p: 2 }}>
            <Stack spacing={1}>
              {direct.length > 0 && (
                <>
                  <Typography variant="caption" fontWeight={600} color="text.secondary">Direct Fields</Typography>
                  {direct.map(r => (
                    <RuleCard key={r.field} field={r.field} rule={r.rule} onSelect={setSelectedField} />
                  ))}
                </>
              )}
              {computed.length > 0 && (
                <>
                  <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mt: 1 }}>
                    Computed Fields
                  </Typography>
                  {computed.map(r => (
                    <RuleCard key={r.field} field={r.field} rule={r.rule} onSelect={setSelectedField} />
                  ))}
                </>
              )}
            </Stack>
          </Box>
        )}

        {viewMode === 'flow' && (
          <MermaidFlowView rules={rules} />
        )}

        {viewMode === 'joins' && (
          <Box sx={{ p: 2 }}>
            <JoinGraphView contract={contract} />
          </Box>
        )}

        {viewMode === 'lineage' && (
          <Box sx={{ p: 2 }}>
            {selectedField && (
              <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">Showing lineage for:</Typography>
                <Chip
                  label={humanizeToken(selectedField)}
                  size="small"
                  color="primary"
                  onDelete={() => setSelectedField(null)}
                />
              </Box>
            )}
            <LineageView
              rules={rules}
              selectedField={selectedField}
              onFieldSelect={setSelectedField}
            />
            {!selectedField && (
              <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: 'block' }}>
                Click a field in the Rules view or in the tree to trace its lineage.
              </Typography>
            )}
          </Box>
        )}
      </Box>
    </Box>
  )
}
