/**
 * LogicTab — Contract rules, data flow, joins, and field lineage.
 *
 * References:
 *   - Mermaid: declarative data flow graphs
 *   - @xyflow/react: interactive join relationship graph
 *   - react-d3-tree: hierarchical field lineage tree
 *   - MUI Stepper: transformation pipeline stages
 *
 * Covers:
 *   4a: Contract readable logic blocks (RuleCard with plain-language)
 *   4b: Per-rule validation indicator (pass/fail/warn icons)
 *   4c: Transformation pipeline view (stepper with enable/disable)
 *   5a: Data flow graph (Mermaid)
 *   5b: Join relationship graph (ReactFlow + edge click popover + 1:N warning)
 *   5c: Field lineage trace (react-d3-tree with cross-panel navigation)
 *   D3: Transformation pipeline view
 *   D5: Join relationship graph
 *   D7: Field lineage trace
 */
import React, { useState, useMemo, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import {
  Box, Card, CardContent, Chip, Collapse, Divider, Paper, Popover, Stack,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import {
  AccountTree as FlowIcon, ExpandMore as ExpandIcon, ExpandLess as CollapseIcon,
  ArrowRightAlt as ArrowIcon, Schema as SchemaIcon, Timeline as LineageIcon,
  Rule as RuleIcon, CheckCircle as PassIcon, Cancel as FailIcon,
  Warning as WarnIcon, Transform as TransformIcon,
} from '@mui/icons-material'
import usePipelineStore from '@/stores/pipeline'
import { humanizeToken, humanizeColumn } from '../../utils'

const ReactFlow = lazy(() => import('@xyflow/react').then(m => ({ default: m.ReactFlow })))
const Tree = lazy(() => import('react-d3-tree').then(m => ({ default: m.default || m.Tree })))

// ── 4a + 4b: Rule Card ──
function RuleCard({ field, rule, onSelect, validationStatus }) {
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
    <Card variant="outlined" sx={{ '&:hover': { borderColor: 'primary.light' }, cursor: 'pointer' }}
      onClick={() => onSelect?.(field)}>
      <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}
        onClick={e => { e.stopPropagation(); setExpanded(o => !o) }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {validationStatus === 'pass' && <PassIcon sx={{ fontSize: 16, color: 'success.main' }} />}
          {validationStatus === 'error' && <FailIcon sx={{ fontSize: 16, color: 'error.main' }} />}
          {validationStatus === 'warning' && <WarnIcon sx={{ fontSize: 16, color: 'warning.main' }} />}
          <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>{humanizeToken(field)}</Typography>
          {expanded ? <CollapseIcon sx={{ fontSize: 16 }} /> : <ExpandIcon sx={{ fontSize: 16 }} />}
        </Box>
        <Typography variant="caption" color="text.secondary">{plainText}</Typography>
      </CardContent>
      <Collapse in={expanded}>
        <Divider />
        <Box sx={{ px: 2, py: 1, bgcolor: '#fafafa' }}>
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
            <Chip label={rule?.source ? humanizeColumn(rule.source) : 'Source'} size="small" color="info" variant="outlined" />
            <ArrowIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
            {rule?.transform && (<><Chip label={rule.transform} size="small" variant="outlined" /><ArrowIcon sx={{ fontSize: 16, color: 'text.disabled' }} /></>)}
            <Chip label={humanizeToken(field)} size="small" color="primary" />
          </Stack>
          {rule && typeof rule === 'object' && (
            <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: 'block', fontFamily: 'monospace', fontSize: '0.65rem' }}>
              {JSON.stringify(rule, null, 2)}
            </Typography>
          )}
        </Box>
      </Collapse>
    </Card>
  )
}

// ── 5a: Mermaid Data Flow ──
function MermaidFlowView({ rules }) {
  const ref = useRef(null)
  const [svg, setSvg] = useState('')

  useEffect(() => {
    if (!rules.length) return
    let cancelled = false
    const lines = ['graph LR']
    const sources = new Set()
    const transforms = new Set()

    rules.forEach(({ field, rule }) => {
      if (!rule) return
      const target = field.replace(/[^a-zA-Z0-9_]/g, '_')
      if (rule.source) {
        const src = rule.source.replace(/[^a-zA-Z0-9_]/g, '_')
        sources.add(src)
        if (rule.transform) {
          const tx = `tx_${target}`
          lines.push(`  ${src}["${humanizeColumn(rule.source)}"] --> ${tx}["${rule.transform}"]`)
          lines.push(`  ${tx} --> ${target}["${humanizeToken(field)}"]`)
          transforms.add(tx)
        } else {
          lines.push(`  ${src}["${humanizeColumn(rule.source)}"] --> ${target}["${humanizeToken(field)}"]`)
        }
      } else if (rule.computed) {
        lines.push(`  comp_${target}(("computed")) --> ${target}["${humanizeToken(field)}"]`)
      }
    })
    lines.push('')
    sources.forEach(s => lines.push(`  style ${s} fill:#e3f2fd,stroke:#2196f3`))
    transforms.forEach(t => lines.push(`  style ${t} fill:#fff3e0,stroke:#ff9800`))

    import('mermaid').then(mermaid => {
      if (cancelled) return
      mermaid.default.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' })
      mermaid.default.render(`mermaid-${Date.now()}`, lines.join('\n')).then(({ svg: s }) => { if (!cancelled) setSvg(s) })
        .catch(() => { if (!cancelled) setSvg('<p style="color:#999;font-size:12px">Could not render diagram</p>') })
    })
    return () => { cancelled = true }
  }, [rules])

  if (!rules.length) return <Typography variant="caption" color="text.secondary" sx={{ p: 2 }}>No rules to visualize.</Typography>
  return <Box ref={ref} sx={{ p: 2, overflow: 'auto', '& svg': { maxWidth: '100%', height: 'auto' } }} dangerouslySetInnerHTML={{ __html: svg }} />
}

// ── 5b/D5: Join Graph ──
function JoinGraphView({ contract }) {
  const [popover, setPopover] = useState(null)
  const joins = useMemo(() => contract?.contract?.joins || contract?.contract?.relationships || [], [contract])

  const { nodes, edges } = useMemo(() => {
    const n = [], e = [], tables = new Set()
    const rules = contract?.contract?.fields || contract?.contract?.rules || contract?.contract?.token_rules || contract?.contract || {}
    if (typeof rules === 'object') Object.values(rules).forEach(r => { if (r?.source) { const p = r.source.split('.'); if (p.length > 1) tables.add(p[0]) } })

    ;[...tables].forEach((t, i) => n.push({
      id: t, data: { label: t }, position: { x: (i % 3) * 200, y: Math.floor(i / 3) * 100 },
      style: { background: '#e3f2fd', border: '1px solid #2196f3', borderRadius: 8, padding: 8, fontSize: 12 },
    }))

    if (Array.isArray(joins)) joins.forEach((j, i) => {
      if (!j.from || !j.to) return
      const is1N = j.cardinality === '1:N' || (typeof j.type === 'string' && (j.type.toLowerCase().includes('left') || j.type.toLowerCase().includes('one_to_many')))
      e.push({
        id: `j-${i}`, source: j.from.split('.')[0], target: j.to.split('.')[0],
        label: is1N ? `⚠ 1:N ${j.type || 'JOIN'}` : (j.type || 'JOIN'),
        style: { stroke: is1N ? '#ff9800' : '#90caf9' },
        labelStyle: { fontSize: 10, fill: is1N ? '#e65100' : undefined },
        data: { idx: i },
      })
    })
    return { nodes: n, edges: e }
  }, [contract, joins])

  const onEdgeClick = useCallback((event, edge) => {
    const j = Array.isArray(joins) ? joins[edge.data?.idx] : null
    if (j) setPopover({ pos: { top: event.clientY, left: event.clientX }, join: j })
  }, [joins])

  if (!nodes.length) return <Typography variant="caption" color="text.secondary" sx={{ p: 2 }}>No join relationships found.</Typography>

  return (
    <Box sx={{ height: 250, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Suspense fallback={<Typography variant="caption" sx={{ p: 2 }}>Loading...</Typography>}>
        <ReactFlow nodes={nodes} edges={edges} onEdgeClick={onEdgeClick} fitView nodesDraggable nodesConnectable={false} style={{ background: '#fafafa' }} />
      </Suspense>
      <Popover open={!!popover} onClose={() => setPopover(null)} anchorReference="anchorPosition" anchorPosition={popover?.pos}>
        {popover?.join && (
          <Box sx={{ p: 2, minWidth: 200 }}>
            <Typography variant="subtitle2" gutterBottom>Join Details</Typography>
            <Typography variant="body2"><strong>Type:</strong> {popover.join.type || 'JOIN'}</Typography>
            <Typography variant="body2"><strong>From:</strong> {popover.join.from}</Typography>
            <Typography variant="body2"><strong>To:</strong> {popover.join.to}</Typography>
            {popover.join.cardinality && <Typography variant="body2"><strong>Cardinality:</strong> {popover.join.cardinality}</Typography>}
          </Box>
        )}
      </Popover>
    </Box>
  )
}

// ── 5c/D7: Lineage Tree ──
function buildFieldTree(field, rule) {
  const node = { name: humanizeToken(field), attributes: { type: 'target', field }, children: [] }
  if (!rule || typeof rule !== 'object') return node
  if (rule.transform || rule.aggregate) {
    const tx = { name: rule.transform || rule.aggregate, attributes: { type: 'transform' }, children: [] }
    if (rule.source) tx.children.push({ name: humanizeColumn(rule.source), attributes: { type: 'source', field: rule.source } })
    node.children.push(tx)
  } else if (rule.source) {
    node.children.push({ name: humanizeColumn(rule.source), attributes: { type: 'source', field: rule.source } })
  }
  if (rule.computed) node.children.push({ name: `computed: ${rule.computed}`, attributes: { type: 'transform' } })
  return node
}

function LineageView({ rules, selectedField, onFieldSelect, setActivePanel }) {
  const setHighlightedField = usePipelineStore(s => s.setHighlightedField)
  const treeData = useMemo(() => {
    if (!selectedField) return { name: 'Template', children: rules.map(({ field, rule }) => buildFieldTree(field, rule)) }
    const r = rules.find(r => r.field === selectedField)
    return r ? buildFieldTree(r.field, r.rule) : { name: humanizeToken(selectedField), children: [] }
  }, [rules, selectedField])

  return (
    <Box sx={{ height: 350, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Suspense fallback={<Typography variant="caption" sx={{ p: 2 }}>Loading...</Typography>}>
        <Tree data={treeData} orientation="horizontal" pathFunc="step" translate={{ x: 50, y: 150 }}
          nodeSize={{ x: 200, y: 50 }} separation={{ siblings: 1, nonSiblings: 1.5 }}
          renderCustomNodeElement={({ nodeDatum }) => (
            <g>
              <rect width={120} height={28} x={-60} y={-14} rx={4}
                fill={nodeDatum.attributes?.type === 'source' ? '#e3f2fd' : nodeDatum.attributes?.type === 'transform' ? '#fff3e0' : '#e8f5e9'}
                stroke={nodeDatum.attributes?.type === 'source' ? '#2196f3' : nodeDatum.attributes?.type === 'transform' ? '#ff9800' : '#4caf50'}
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  if (nodeDatum.attributes?.field) {
                    onFieldSelect?.(nodeDatum.attributes.field)
                    setHighlightedField(nodeDatum.attributes.field)
                    if (nodeDatum.attributes.type === 'source') setActivePanel?.('data')
                  }
                }}
              />
              <text x={0} y={4} textAnchor="middle" style={{ fontSize: 10, fill: '#333' }}>
                {nodeDatum.name.length > 18 ? nodeDatum.name.slice(0, 16) + '…' : nodeDatum.name}
              </text>
            </g>
          )}
        />
      </Suspense>
    </Box>
  )
}

// ── 4c/D3: Transform Pipeline ──
function TransformPipelineView({ rules, selectedField, onFieldSelect }) {
  const transformDisabledSteps = usePipelineStore(s => s.transformDisabledSteps)
  const setTransformStepDisabled = usePipelineStore(s => s.setTransformStepDisabled)

  if (!selectedField) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <TransformIcon sx={{ fontSize: 40, color: '#e0e0e0', mb: 1 }} />
        <Typography color="text.secondary" variant="body2">Select a field to see its transformation pipeline.</Typography>
        <Stack direction="row" spacing={0.5} flexWrap="wrap" justifyContent="center" sx={{ mt: 2, gap: 0.5 }}>
          {rules.slice(0, 12).map(r => (
            <Chip key={r.field} label={humanizeToken(r.field)} size="small" variant="outlined" onClick={() => onFieldSelect?.(r.field)} sx={{ cursor: 'pointer' }} />
          ))}
        </Stack>
      </Box>
    )
  }

  const ruleEntry = rules.find(r => r.field === selectedField)
  const rule = ruleEntry?.rule
  const stages = []
  if (rule?.source) stages.push({ key: 'source', label: 'Source', detail: humanizeColumn(rule.source), color: '#e3f2fd', border: '#2196f3' })
  if (rule?.transform) stages.push({ key: 'transform', label: 'Transform', detail: rule.transform, color: '#fff3e0', border: '#ff9800' })
  if (rule?.aggregate) stages.push({ key: 'aggregate', label: 'Aggregate', detail: rule.aggregate, color: '#fce4ec', border: '#e91e63' })
  if (rule?.format) stages.push({ key: 'format', label: 'Format', detail: rule.format, color: '#f3e5f5', border: '#9c27b0' })
  if (rule?.default != null) stages.push({ key: 'default', label: 'Default', detail: String(rule.default), color: '#e8eaf6', border: '#3f51b5' })
  if (rule?.computed) stages.push({ key: 'computed', label: 'Computed', detail: rule.computed, color: '#fff3e0', border: '#ff9800' })
  stages.push({ key: 'output', label: 'Output', detail: humanizeToken(selectedField), color: '#e8f5e9', border: '#4caf50' })

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2">Pipeline for:</Typography>
        <Chip label={humanizeToken(selectedField)} size="small" color="primary" onDelete={() => onFieldSelect?.(null)} />
      </Box>
      <Stack direction="row" alignItems="center" spacing={0} sx={{ overflowX: 'auto', pb: 1 }}>
        {stages.map((s, i) => {
          const disabled = transformDisabledSteps[`${selectedField}.${s.key}`]
          return (
            <React.Fragment key={s.key}>
              {i > 0 && <ArrowIcon sx={{ fontSize: 24, color: 'text.disabled', flexShrink: 0, mx: 0.5 }} />}
              <Paper variant="outlined"
                onDoubleClick={() => setTransformStepDisabled(selectedField, s.key, !disabled)}
                sx={{
                  p: 1.5, minWidth: 100, textAlign: 'center', cursor: 'pointer', flexShrink: 0,
                  bgcolor: disabled ? '#f5f5f5' : s.color, borderColor: disabled ? '#e0e0e0' : s.border,
                  opacity: disabled ? 0.5 : 1, '&:hover': { boxShadow: 2 }, transition: 'all 0.2s',
                }}>
                <Typography variant="caption" fontWeight={600} display="block">{s.label}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', wordBreak: 'break-word' }}>{s.detail}</Typography>
              </Paper>
            </React.Fragment>
          )
        })}
      </Stack>
      <Typography variant="caption" color="text.disabled" sx={{ mt: 1, display: 'block' }}>Double-click a stage to toggle on/off.</Typography>
    </Box>
  )
}

// ── Main Component ──
export default function LogicTab({ onAction }) {
  const contract = usePipelineStore(s => s.pipelineState.data.contract)
  const validation = usePipelineStore(s => s.pipelineState.data.validation)
  const setActivePanel = usePipelineStore(s => s.setActivePanel)
  const [viewMode, setViewMode] = useState('rules')
  const [selectedField, setSelectedField] = useState(null)

  const fieldValidation = useMemo(() => {
    const map = {}
    ;(validation?.issues || []).forEach(issue => {
      const f = issue.token || issue.field
      if (!f) return
      if (!map[f] || (issue.severity === 'error' && map[f] !== 'error')) map[f] = issue.severity === 'error' ? 'error' : 'warning'
    })
    return map
  }, [validation?.issues])

  const rules = useMemo(() => {
    if (!contract?.contract) return []
    const c = contract.contract
    const fields = c.fields || c.rules || c.token_rules || c
    return typeof fields === 'object' && !Array.isArray(fields) ? Object.entries(fields).map(([field, rule]) => ({ field, rule })) : []
  }, [contract])

  if (!rules.length) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 4 }}>
        <Box sx={{ textAlign: 'center' }}>
          <FlowIcon sx={{ fontSize: 48, color: '#e0e0e0', mb: 1 }} />
          <Typography color="text.secondary">No report structure yet.</Typography>
          <Typography variant="caption" color="text.disabled">Appears after mapping is approved.</Typography>
        </Box>
      </Box>
    )
  }

  const computed = rules.filter(r => r.rule?.computed || r.rule?.aggregate)
  const direct = rules.filter(r => !r.rule?.computed && !r.rule?.aggregate)

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>Report Structure</Typography>
        <Chip label={`${rules.length} rules`} size="small" variant="outlined" />
      </Box>

      <Box sx={{ px: 2, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
        <ToggleButtonGroup size="small" value={viewMode} exclusive onChange={(_, v) => v && setViewMode(v)}
          sx={{ '& .MuiToggleButton-root': { px: 1, py: 0.25, fontSize: '0.7rem' } }}>
          <ToggleButton value="rules"><RuleIcon sx={{ fontSize: 14, mr: 0.5 }} />Rules</ToggleButton>
          <ToggleButton value="flow"><FlowIcon sx={{ fontSize: 14, mr: 0.5 }} />Flow</ToggleButton>
          <ToggleButton value="joins"><SchemaIcon sx={{ fontSize: 14, mr: 0.5 }} />Joins</ToggleButton>
          <ToggleButton value="lineage"><LineageIcon sx={{ fontSize: 14, mr: 0.5 }} />Lineage</ToggleButton>
          <ToggleButton value="transform"><TransformIcon sx={{ fontSize: 14, mr: 0.5 }} />Transform</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {viewMode === 'rules' && (
          <Box sx={{ p: 2 }}>
            <Stack spacing={1}>
              {direct.length > 0 && (<><Typography variant="caption" fontWeight={600} color="text.secondary">Direct Fields</Typography>
                {direct.map(r => <RuleCard key={r.field} field={r.field} rule={r.rule} onSelect={setSelectedField} validationStatus={fieldValidation[r.field] || 'pass'} />)}</>)}
              {computed.length > 0 && (<><Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mt: 1 }}>Computed Fields</Typography>
                {computed.map(r => <RuleCard key={r.field} field={r.field} rule={r.rule} onSelect={setSelectedField} validationStatus={fieldValidation[r.field] || 'pass'} />)}</>)}
            </Stack>
          </Box>
        )}
        {viewMode === 'flow' && <MermaidFlowView rules={rules} />}
        {viewMode === 'joins' && <Box sx={{ p: 2 }}><JoinGraphView contract={contract} /></Box>}
        {viewMode === 'lineage' && <Box sx={{ p: 2 }}><LineageView rules={rules} selectedField={selectedField} onFieldSelect={setSelectedField} setActivePanel={setActivePanel} /></Box>}
        {viewMode === 'transform' && <TransformPipelineView rules={rules} selectedField={selectedField} onFieldSelect={setSelectedField} />}
      </Box>
    </Box>
  )
}
