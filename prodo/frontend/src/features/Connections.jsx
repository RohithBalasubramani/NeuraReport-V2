import * as api from '@/api/client'
import { testConnection } from '@/api/client'
import { neutral, palette, status as statusColors } from '@/app/theme'
import { FavoriteButton, useToast } from '@/components/core'
import { DataTable } from '@/components/data'
import { InteractionType, Reversibility, useInteraction } from '@/components/governance'
import { ConfirmModal, Drawer } from '@/components/modals'
import { useAppStore } from '@/stores/app'
import { PaddedPageContainer as PageContainer, fadeInUp } from '@/styles/styles'
import { combineValidators, validateMaxLength, validateMinLength, validateRequired } from '@/utils/helpers'
import AddIcon from '@mui/icons-material/Add'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import ErrorIcon from '@mui/icons-material/Error'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import RefreshIcon from '@mui/icons-material/Refresh'
import StorageIcon from '@mui/icons-material/Storage'
import TableViewIcon from '@mui/icons-material/TableView'
import VisibilityIcon from '@mui/icons-material/Visibility'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  alpha,
  styled,
  useTheme,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
const FIELD_HELP = {
  name: 'A friendly name to identify this connection. Example: "Production Database" or "Local Dev".',
  db_type: 'The type of database you\'re connecting to. Contact your database administrator if you\'re unsure.',
  host: 'The server address where your database is hosted. This could be a domain name (db.example.com) or an IP address (192.168.1.1). Use "localhost" for local databases.',
  port: 'The port number your database listens on. Default ports: PostgreSQL (5432), MySQL (3306), SQL Server (1433). Usually you don\'t need to change this.',
  database: 'The name of the specific database you want to connect to on the server. Ask your database administrator if you\'re not sure.',
  database_sqlite: 'The file path to your SQLite database file. Example: /home/user/data/myapp.db',
  username: 'Your database username. This is the account that will be used to run queries.',
  password: 'Your database password. This will be stored securely and encrypted.',
  ssl: 'Enable SSL/TLS encryption for secure connections. Recommended for production databases, especially over the internet.',
}

function HelpIcon({ field }) {
  const helpText = FIELD_HELP[field]
  if (!helpText) return null

  return (
    <Tooltip title={helpText} arrow placement="top">
      <IconButton size="small" sx={{ p: 0.5 }} aria-label={helpText}>
        <HelpOutlineIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
      </IconButton>
    </Tooltip>
  )
}

const DB_TYPES = [
  { value: 'sqlite', label: 'SQLite', port: null, requiresAuth: false },
  { value: 'postgresql', label: 'PostgreSQL', port: 5432, requiresAuth: true },
  { value: 'mysql', label: 'MySQL', port: 3306, requiresAuth: true },
  { value: 'mssql', label: 'SQL Server', port: 1433, requiresAuth: true },
  { value: 'mariadb', label: 'MariaDB', port: 3306, requiresAuth: true },
]

// Field validators
const validators = {
  name: combineValidators(
    (v) => validateRequired(v, 'Connection name'),
    (v) => validateMinLength(v, 2, 'Connection name'),
    (v) => validateMaxLength(v, 100, 'Connection name')
  ),
  host: (value, allValues) => {
    if (allValues.db_type === 'sqlite') return { valid: true, error: null }
    return combineValidators(
      (v) => validateRequired(v, 'Host'),
      (v) => validateMaxLength(v, 255, 'Host')
    )(value)
  },
  database: combineValidators(
    (v) => validateRequired(v, 'Database name'),
    (v) => validateMaxLength(v, 255, 'Database name')
  ),
  port: (value) => {
    const port = parseInt(value, 10)
    if (isNaN(port) || port < 1 || port > 65535) {
      return { valid: false, error: 'Port must be between 1 and 65535' }
    }
    return { valid: true, error: null }
  },
}

export function ConnectionForm({ connection, onSave, onCancel, loading }) {
  const initialDbType = DB_TYPES.some((type) => type.value === connection?.db_type)
    ? connection?.db_type
    : 'sqlite'
  const [formData, setFormData] = useState({
    name: connection?.name || '',
    db_type: initialDbType,
    host: connection?.host || 'localhost',
    port: connection?.port || 5432,
    database: connection?.database || '',
    username: connection?.username || '',
    password: '',
    ssl: connection?.ssl ?? true,
  })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [error, setError] = useState(null)
  const [touched, setTouched] = useState({})
  const [fieldErrors, setFieldErrors] = useState({})
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null) // 'success' | 'error' | null
  const submitDebounceRef = useRef(false)
  const { execute } = useInteraction()

  const handleChange = useCallback((field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setFormData((prev) => {
      const newData = { ...prev, [field]: value }
      // Validate on change if field was already touched
      if (touched[field] && validators[field]) {
        const result = validators[field](value, newData)
        setFieldErrors((e) => ({ ...e, [field]: result.error }))
      }
      return newData
    })
    setError(null)
  }, [touched])

  const handleBlur = useCallback((field) => () => {
    setTouched((prev) => ({ ...prev, [field]: true }))
    if (validators[field]) {
      const result = validators[field](formData[field], formData)
      setFieldErrors((prev) => ({ ...prev, [field]: result.error }))
    }
  }, [formData])

  const handleDbTypeChange = useCallback((event) => {
    const dbType = event.target.value
    const typeConfig = DB_TYPES.find((t) => t.value === dbType)
    setFormData((prev) => ({
      ...prev,
      db_type: dbType,
      port: typeConfig?.port || prev.port,
    }))
    setTestResult(null)
  }, [])

  const buildConnectionUrl = useCallback(() => {
    if (formData.db_type === 'sqlite') {
      // For SQLite we rely on the explicit `database` path field (sent as `database`)
      // because `sqlite:///relative/path.db` parses as an absolute path on Windows.
      return null
    }
    const auth = formData.username
      ? `${formData.username}${formData.password ? `:${formData.password}` : ''}@`
      : ''
    return `${formData.db_type}://${auth}${formData.host}:${formData.port}/${formData.database}`
  }, [formData])

  const handleTestConnection = useCallback(async () => {
    // Validate required fields first
    const requiredErrors = {}
    if (!formData.database.trim()) {
      requiredErrors.database = 'Database is required to test'
    }
    if (formData.db_type !== 'sqlite' && !formData.host.trim()) {
      requiredErrors.host = 'Host is required to test'
    }

    if (Object.keys(requiredErrors).length > 0) {
      setFieldErrors((prev) => ({ ...prev, ...requiredErrors }))
      setTouched((prev) => ({ ...prev, database: true, host: true }))
      return
    }

    await execute({
      type: InteractionType.EXECUTE,
      label: 'Test connection',
      reversibility: Reversibility.SYSTEM_MANAGED,
      suppressSuccessToast: true,
      suppressErrorToast: true,
      intent: {
        dbType: formData.db_type,
        action: 'test_connection',
      },
      action: async () => {
        setTesting(true)
        setTestResult(null)
        setError(null)

        try {
          const db_url = buildConnectionUrl()
          const result = await testConnection({
            db_url,
            db_type: formData.db_type,
            database: formData.database,
          })
          if (
            result?.status === 'healthy'
            || result?.healthy
            || result?.status === 'ok'
            || result?.ok
          ) {
            setTestResult('success')
          } else {
            setTestResult('error')
            setError(result?.message || result?.error || 'Connection test failed')
          }
          return result
        } catch (err) {
          setTestResult('error')
          setError(err.message || 'Connection test failed')
          throw err
        } finally {
          setTesting(false)
        }
      },
    })
  }, [buildConnectionUrl, execute, formData])

  const handleSubmit = useCallback((e) => {
    e.preventDefault()

    // Debounce protection against double-submit
    if (submitDebounceRef.current) return
    submitDebounceRef.current = true
    setTimeout(() => { submitDebounceRef.current = false }, 1000)

    // Mark all fields as touched
    const allTouched = { name: true, host: true, database: true, port: true }
    setTouched(allTouched)

    // Validate all fields
    const errors = {}
    let hasErrors = false

    for (const [field, validator] of Object.entries(validators)) {
      const result = validator(formData[field], formData)
      if (!result.valid) {
        errors[field] = result.error
        hasErrors = true
      }
    }

    setFieldErrors(errors)

    if (hasErrors) {
      const firstError = Object.values(errors).find(Boolean)
      setError(firstError || 'Please fix the errors above')
      return
    }

    const db_url = buildConnectionUrl()

    onSave({
      ...formData,
      db_url,
    })
  }, [formData, onSave, buildConnectionUrl])

  const isSqlite = formData.db_type === 'sqlite'

  // Compute whether the form has minimum required data for submission
  const isFormValid = useMemo(() => {
    const nameValid = formData.name.trim().length >= 2
    const dbValid = formData.database.trim().length > 0
    if (isSqlite) return nameValid && dbValid
    const hostValid = formData.host.trim().length > 0
    return nameValid && dbValid && hostValid
  }, [formData.name, formData.database, formData.host, isSqlite])

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <Stack spacing={3}>
        {error && (
          <Alert
            severity="error"
            onClose={() => setError(null)}
            action={
              testResult === 'error' && (
                <Button
                  color="inherit"
                  size="small"
                  onClick={handleTestConnection}
                  disabled={testing}
                >
                  Try Again
                </Button>
              )
            }
          >
            {error}
          </Alert>
        )}

        <Alert severity="info">
          Use a read-only account when possible. Testing only checks connectivity. Saved credentials are encrypted for
          reuse. Deleting a connection never deletes data from your database.
        </Alert>

        <TextField
          label={
            <Stack direction="row" alignItems="center" spacing={0.5} component="span">
              <span>Connection Name</span>
              <HelpIcon field="name" />
            </Stack>
          }
          value={formData.name}
          onChange={handleChange('name')}
          onBlur={handleBlur('name')}
          placeholder="e.g., Production Database"
          required
          fullWidth
          inputProps={{ maxLength: 100 }}
          error={touched.name && Boolean(fieldErrors.name)}
          helperText={touched.name && fieldErrors.name}
        />

        <FormControl fullWidth>
          <InputLabel>
            <Stack direction="row" alignItems="center" spacing={0.5} component="span">
              <span>Database Type</span>
              <HelpIcon field="db_type" />
            </Stack>
          </InputLabel>
          <Select
            value={formData.db_type}
            onChange={handleDbTypeChange}
            label="Database Type      "
          >
            {DB_TYPES.map((type) => (
              <MenuItem key={type.value} value={type.value}>
                {type.label}
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>Not sure? Ask your database administrator</FormHelperText>
        </FormControl>

        {!isSqlite && (
          <Stack direction="row" spacing={2}>
            <TextField
              label={
                <Stack direction="row" alignItems="center" spacing={0.5} component="span">
                  <span>Server Address</span>
                  <HelpIcon field="host" />
                </Stack>
              }
              value={formData.host}
              onChange={handleChange('host')}
              onBlur={handleBlur('host')}
              placeholder="e.g., db.example.com"
              required
              sx={{ flex: 2 }}
              error={touched.host && Boolean(fieldErrors.host)}
              helperText={touched.host ? fieldErrors.host : 'The URL or IP address of your database server'}
            />
            <TextField
              label={
                <Stack direction="row" alignItems="center" spacing={0.5} component="span">
                  <span>Port</span>
                  <HelpIcon field="port" />
                </Stack>
              }
              type="number"
              value={formData.port}
              onChange={handleChange('port')}
              onBlur={handleBlur('port')}
              sx={{ flex: 1 }}
              error={touched.port && Boolean(fieldErrors.port)}
              helperText={touched.port ? fieldErrors.port : 'Usually automatic'}
            />
          </Stack>
        )}

        <TextField
          label={
            <Stack direction="row" alignItems="center" spacing={0.5} component="span">
              <span>{isSqlite ? 'Database Path' : 'Database Name'}</span>
              <HelpIcon field={isSqlite ? 'database_sqlite' : 'database'} />
            </Stack>
          }
          value={formData.database}
          onChange={handleChange('database')}
          onBlur={handleBlur('database')}
          placeholder={isSqlite ? '/path/to/database.db' : 'e.g., my_database'}
          required
          fullWidth
          error={touched.database && Boolean(fieldErrors.database)}
          helperText={touched.database ? fieldErrors.database : (isSqlite ? 'Full path to your SQLite file' : 'The name of the database on the server')}
        />

        {!isSqlite && (
          <>
            <TextField
              label={
                <Stack direction="row" alignItems="center" spacing={0.5} component="span">
                  <span>Username</span>
                  <HelpIcon field="username" />
                </Stack>
              }
              value={formData.username}
              onChange={handleChange('username')}
              placeholder="e.g., postgres"
              fullWidth
              helperText="The database account to use"
            />

            <TextField
              label={
                <Stack direction="row" alignItems="center" spacing={0.5} component="span">
                  <span>Password</span>
                  <HelpIcon field="password" />
                </Stack>
              }
              type="password"
              value={formData.password}
              onChange={handleChange('password')}
              placeholder="Enter password"
              fullWidth
              helperText="Stored securely and encrypted"
            />
          </>
        )}

        {/* Advanced Settings */}
        <Box>
          <Button
            variant="text"
            size="small"
            onClick={() => setShowAdvanced((prev) => !prev)}
            endIcon={showAdvanced ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            sx={{ textTransform: 'none', fontWeight: 500 }}
          >
            Advanced Settings
          </Button>

          <Collapse in={showAdvanced}>
            <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Stack spacing={2}>
                {!isSqlite && (
                  <FormControlLabel
                    control={
                      <Switch
                        checked={formData.ssl}
                        onChange={handleChange('ssl')}
                      />
                    }
                    label={
                      <Stack direction="row" alignItems="center" spacing={0.5}>
                        <span>Use Secure Connection (SSL)</span>
                        <HelpIcon field="ssl" />
                      </Stack>
                    }
                  />
                )}
                {isSqlite && (
                  <Typography variant="caption" color="text.secondary">
                    SQLite databases use file-based storage and do not require additional configuration.
                  </Typography>
                )}
              </Stack>
            </Box>
          </Collapse>
        </Box>

        <Divider />

        {/* Test Connection Result */}
        {testResult && (
          <Alert
            severity={testResult === 'success' ? 'success' : 'error'}
            icon={testResult === 'success' ? <CheckCircleIcon /> : <ErrorIcon />}
            onClose={() => setTestResult(null)}
            action={
              testResult === 'error' && (
                <Button
                  color="inherit"
                  size="small"
                  onClick={handleTestConnection}
                  disabled={testing}
                >
                  Retry
                </Button>
              )
            }
          >
            {testResult === 'success'
              ? 'Connection successful! Database is reachable.'
              : error || 'Connection failed. Check your settings and try again.'}
          </Alert>
        )}

        {/* Actions */}
        <Stack direction="row" spacing={2} justifyContent="flex-end">
          <Button
            variant="text"
            onClick={handleTestConnection}
            disabled={loading || testing}
            startIcon={testing ? <CircularProgress size={16} /> : null}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </Button>
          <Button
            variant="outlined"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={loading || !isFormValid}
          >
            {connection ? 'Update Connection' : 'Add Connection'}
          </Button>
        </Stack>
      </Stack>
    </Box>
  )
}

// === From: ConnectionSchemaDrawer.jsx ===
/**
 * Premium Connection Schema Drawer
 * Database schema inspector with theme-based styling
 */

const formatRowCount = (value) => {
  if (value == null) return 'n/a'
  return value.toLocaleString()
}

function ConnectionSchemaDrawer({ open, onClose, connection }) {
  const theme = useTheme()
  const { execute } = useInteraction()
  const [schema, setSchema] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('')
  const [previewState, setPreviewState] = useState({})

  const fetchSchema = useCallback(async () => {
    if (!connection?.id) return
    setLoading(true)
    setError(null)
    try {
      const result = await api.getConnectionSchema(connection.id, {
        includeRowCounts: true,
        includeForeignKeys: true,
      })
      setSchema(result)
    } catch (err) {
      setError(err.message || 'Failed to load schema')
    } finally {
      setLoading(false)
    }
  }, [connection?.id])

  useEffect(() => {
    if (open) {
      fetchSchema()
    }
  }, [open, fetchSchema])

  const filteredTables = useMemo(() => {
    const tables = schema?.tables || []
    const query = filter.trim().toLowerCase()
    if (!query) return tables
    return tables.filter((table) => table.name.toLowerCase().includes(query))
  }, [schema, filter])

  const handlePreview = useCallback((tableName) => {
    if (!connection?.id || !tableName) return undefined
    return execute({
      type: InteractionType.EXECUTE,
      label: `Preview ${tableName}`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      intent: { connectionId: connection.id, table: tableName },
      action: async () => {
        setPreviewState((prev) => ({
          ...prev,
          [tableName]: { ...(prev[tableName] || {}), loading: true, error: null },
        }))
        try {
          const result = await api.getConnectionTablePreview(connection.id, {
            table: tableName,
            limit: 6,
          })
          setPreviewState((prev) => ({
            ...prev,
            [tableName]: {
              loading: false,
              error: null,
              columns: result.columns || [],
              rows: result.rows || [],
            },
          }))
        } catch (err) {
          setPreviewState((prev) => ({
            ...prev,
            [tableName]: { ...(prev[tableName] || {}), loading: false, error: err.message || 'Preview failed' },
          }))
        }
      },
    })
  }, [connection?.id, execute])

  const handleRefreshSchema = useCallback(() => {
    return execute({
      type: InteractionType.EXECUTE,
      label: 'Refresh schema',
      reversibility: Reversibility.FULLY_REVERSIBLE,
      suppressSuccessToast: true,
      intent: { connectionId: connection?.id },
      action: fetchSchema,
    })
  }, [connection?.id, execute, fetchSchema])

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Connection Schema"
      subtitle={connection?.name || connection?.summary || 'Database overview'}
      width={680}
      actions={(
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            variant="outlined"
            onClick={handleRefreshSchema}
            startIcon={<RefreshIcon />}
            sx={{
              borderRadius: 1,  // Figma spec: 8px
              textTransform: 'none',
              borderColor: alpha(theme.palette.divider, 0.2),
              color: theme.palette.text.secondary,
              '&:hover': {
                borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
                bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
              },
            }}
          >
            Refresh
          </Button>
        </Stack>
      )}
    >
      <Stack spacing={2}>
        <TextField
          label="Filter tables"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          size="small"
          fullWidth
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: 1,  // Figma spec: 8px
              bgcolor: alpha(theme.palette.background.paper, 0.5),
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: alpha(theme.palette.divider, 0.15),
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: alpha(theme.palette.divider, 0.3),
              },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
              },
            },
          }}
        />
        {loading && <LinearProgress sx={{ borderRadius: 1, bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], '& .MuiLinearProgress-bar': { bgcolor: (theme) => theme.palette.mode === 'dark' ? neutral[500] : neutral[700] } }} />}
        {error && (
          <Alert
            severity="error"
            sx={{ borderRadius: 1 }}  // Figma spec: 8px
            action={
              <Button color="inherit" size="small" onClick={handleRefreshSchema}>
                Retry
              </Button>
            }
          >
            {error === 'Failed to load schema'
              ? 'Unable to connect to database. Please verify the connection is active and try again.'
              : error}
          </Alert>
        )}
        {!loading && !error && (
          <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
            {schema?.table_count || 0} tables found
          </Typography>
        )}
        {filteredTables.map((table) => {
          const preview = previewState[table.name] || {}
          return (
            <Accordion
              key={table.name}
              disableGutters
              sx={{
                bgcolor: alpha(theme.palette.background.paper, 0.5),
                border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                borderRadius: '8px !important',  // Figma spec: 8px
                '&:before': { display: 'none' },
                '&.Mui-expanded': {
                  margin: 0,
                },
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon sx={{ color: theme.palette.text.secondary }} />}
                sx={{
                  borderRadius: 1,  // Figma spec: 8px
                  '&:hover': {
                    bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
                  },
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography sx={{ fontWeight: 600, color: theme.palette.text.primary }}>
                    {table.name}
                  </Typography>
                  <Chip
                    size="small"
                    label={`${formatRowCount(table.row_count)} rows`}
                    sx={{
                      bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                      color: theme.palette.text.secondary,
                      fontSize: '12px',
                      height: 22,
                      borderRadius: 1,  // Figma spec: 8px
                    }}
                  />
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1.5}>
                  <Box>
                    <Typography
                      variant="subtitle2"
                      sx={{ mb: 1, color: theme.palette.text.primary }}
                    >
                      Columns
                    </Typography>
                    <Table
                      size="small"
                      sx={{
                        '& .MuiTableCell-head': {
                          bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
                          fontWeight: 600,
                          fontSize: '0.75rem',
                          color: theme.palette.text.secondary,
                        },
                        '& .MuiTableCell-body': {
                          fontSize: '14px',
                          color: theme.palette.text.primary,
                        },
                      }}
                    >
                      <TableHead>
                        <TableRow>
                          <TableCell>Name</TableCell>
                          <TableCell>Type</TableCell>
                          <TableCell>PK</TableCell>
                          <TableCell>Required</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(table.columns || []).map((column) => (
                          <TableRow key={column.name}>
                            <TableCell>{column.name}</TableCell>
                            <TableCell>{column.type || '-'}</TableCell>
                            <TableCell>{column.pk ? 'Yes' : '-'}</TableCell>
                            <TableCell>{column.notnull ? 'Yes' : '-'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>

                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                      <Typography
                        variant="subtitle2"
                        sx={{ color: theme.palette.text.primary }}
                      >
                        Preview
                      </Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<VisibilityIcon />}
                        onClick={() => handlePreview(table.name)}
                        sx={{
                          borderRadius: 1,  // Figma spec: 8px
                          textTransform: 'none',
                          fontSize: '0.75rem',
                          borderColor: alpha(theme.palette.divider, 0.2),
                          '&:hover': {
                            borderColor: theme.palette.mode === 'dark' ? neutral[500] : neutral[700],
                            bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
                          },
                        }}
                      >
                        Load preview
                      </Button>
                    </Stack>
                    {preview.loading && <LinearProgress sx={{ mt: 1, borderRadius: 1, bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[100], '& .MuiLinearProgress-bar': { bgcolor: (theme) => theme.palette.mode === 'dark' ? neutral[500] : neutral[700] } }} />}
                    {preview.error && (
                      <Alert severity="error" sx={{ mt: 1, borderRadius: 1 }}>  {/* Figma spec: 8px */}
                        {preview.error}
                      </Alert>
                    )}
                    {preview.rows && preview.rows.length > 0 && (
                      <Table
                        size="small"
                        sx={{
                          mt: 1,
                          '& .MuiTableCell-head': {
                            bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.05) : neutral[50],
                            fontWeight: 600,
                            fontSize: '0.75rem',
                            color: theme.palette.text.secondary,
                          },
                          '& .MuiTableCell-body': {
                            fontSize: '0.75rem',
                            color: theme.palette.text.primary,
                          },
                        }}
                      >
                        <TableHead>
                          <TableRow>
                            {(preview.columns || []).map((col) => (
                              <TableCell key={col}>{col}</TableCell>
                            ))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {preview.rows.map((row, idx) => (
                            <TableRow key={`${table.name}-row-${idx}`}>
                              {(preview.columns || []).map((col) => (
                                <TableCell key={`${table.name}-${idx}-${col}`}>
                                  {row[col] == null ? '-' : String(row[col])}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                    {!preview.loading && preview.rows && preview.rows.length === 0 && (
                      <Typography
                        variant="body2"
                        sx={{ mt: 1, color: theme.palette.text.secondary }}
                      >
                        No rows returned.
                      </Typography>
                    )}
                  </Box>
                </Stack>
              </AccordionDetails>
            </Accordion>
          )
        })}
      </Stack>
    </Drawer>
  )
}

// === From: ConnectionsPageContainer.jsx ===
/**
 * Premium Connections Page
 * Data source management with theme-based styling
 */
// UX Governance - Enforced interaction API



const StyledMenu = styled(Menu)(({ theme }) => ({
  '& .MuiPaper-root': {
    backgroundColor: alpha(theme.palette.background.paper, 0.95),
    backdropFilter: 'blur(20px)',
    border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
    borderRadius: 8,  // Figma spec: 8px
    boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.15)}`,
    minWidth: 160,
    animation: `${fadeInUp} 0.2s ease-out`,
  },
}))

const StyledMenuItem = styled(MenuItem)(({ theme }) => ({
  borderRadius: 8,
  margin: theme.spacing(0.5, 1),
  padding: theme.spacing(1, 1.5),
  fontSize: '14px',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
  },
}))

const IconContainer = styled(Box)(({ theme }) => ({
  width: 32,
  height: 32,
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
}))

const ActionButton = styled(IconButton)(({ theme }) => ({
  borderRadius: 8,  // Figma spec: 8px
  transition: 'all 0.2s cubic-bezier(0.22, 1, 0.36, 1)',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
    transform: 'scale(1.05)',
  },
}))


export default function ConnectionsPage() {
  const theme = useTheme()
  const toast = useToast()
  // UX Governance: Enforced interaction API - ALL user actions flow through this
  const { execute } = useInteraction()
  const savedConnections = useAppStore((s) => s.savedConnections)
  const setSavedConnections = useAppStore((s) => s.setSavedConnections)
  const addSavedConnection = useAppStore((s) => s.addSavedConnection)
  const removeSavedConnection = useAppStore((s) => s.removeSavedConnection)
  const setActiveConnectionId = useAppStore((s) => s.setActiveConnectionId)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)

  const [loading, setLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingConnection, setEditingConnection] = useState(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingConnection, setDeletingConnection] = useState(null)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [menuConnection, setMenuConnection] = useState(null)
  const [schemaOpen, setSchemaOpen] = useState(false)
  const [schemaConnection, setSchemaConnection] = useState(null)
  const [favorites, setFavorites] = useState(new Set())
  const didLoadFavoritesRef = useRef(false)

  useEffect(() => {
    if (didLoadFavoritesRef.current) return
    didLoadFavoritesRef.current = true
    api.getFavorites()
      .then((data) => {
        const favIds = (data.connections || []).map((c) => c.id)
        setFavorites(new Set(favIds))
      })
      .catch((err) => {
        console.error('Failed to load favorites:', err)
        // Non-critical - don't block UI but log for debugging
      })
  }, [])

  const handleFavoriteToggle = useCallback((connectionId, isFavorite) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (isFavorite) {
        next.add(connectionId)
      } else {
        next.delete(connectionId)
      }
      return next
    })
  }, [])

  const handleOpenMenu = useCallback((event, connection) => {
    event.stopPropagation()
    setMenuAnchor(event.currentTarget)
    setMenuConnection(connection)
  }, [])

  const handleCloseMenu = useCallback(() => {
    setMenuAnchor(null)
    setMenuConnection(null)
  }, [])

  const drawerOpenRef = useRef(false)
  const handleAddConnection = useCallback(() => {
    if (drawerOpenRef.current) return // Ref-based guard: prevents double-click opening duplicate drawers
    drawerOpenRef.current = true
    setEditingConnection(null)
    setDrawerOpen(true)
  }, [])

  const handleEditConnection = useCallback(() => {
    setEditingConnection(menuConnection)
    setDrawerOpen(true)
    handleCloseMenu()
  }, [menuConnection, handleCloseMenu])

  const handleDeleteClick = useCallback(() => {
    setDeletingConnection(menuConnection)
    setDeleteConfirmOpen(true)
    handleCloseMenu()
  }, [menuConnection, handleCloseMenu])

  const handleSchemaInspect = useCallback(async () => {
    if (!menuConnection) return
    const connectionToInspect = menuConnection
    handleCloseMenu()

    // UX Governance: Analyze action with tracking
    execute({
      type: InteractionType.ANALYZE,
      label: `Inspect schema for "${connectionToInspect.name}"`,
      reversibility: Reversibility.SYSTEM_MANAGED,
      errorMessage: 'Unable to connect to database. Please verify the connection is active.',
      action: async () => {
        setLoading(true)
        try {
          const result = await api.healthcheckConnection(connectionToInspect.id)
          if (result.status !== 'ok') {
            throw new Error('Connection is unavailable. Please verify connection settings.')
          }
          setSchemaConnection(connectionToInspect)
          setSchemaOpen(true)
        } finally {
          setLoading(false)
        }
      },
    })
  }, [menuConnection, handleCloseMenu, execute])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingConnection) return
    const connectionToDelete = deletingConnection
    const connectionData = savedConnections.find((c) => c.id === connectionToDelete.id)

    setDeleteConfirmOpen(false)
    setDeletingConnection(null)

    // UX Governance: Delete action with tracking
    execute({
      type: InteractionType.DELETE,
      label: `Delete data source "${connectionToDelete.name}"`,
      reversibility: Reversibility.PARTIALLY_REVERSIBLE,
      successMessage: `"${connectionToDelete.name}" removed`,
      errorMessage: 'Failed to delete connection',
      action: async () => {
        // Remove from UI immediately
        removeSavedConnection(connectionToDelete.id)

        // Delete from backend immediately (no delayed timeout)
        try {
          await api.deleteConnection(connectionToDelete.id)
        } catch (err) {
          // If delete fails, restore the connection to UI
          if (connectionData) {
            addSavedConnection(connectionData)
          }
          throw err
        }

        // Show undo toast - undo will re-create the connection
        toast.showWithUndo(
          `"${connectionToDelete.name}" removed`,
          async () => {
            // Undo: re-create the connection via API
            if (connectionData) {
              try {
                const restored = await api.upsertConnection({
                  name: connectionData.name,
                  dbType: connectionData.db_type,
                  dbUrl: connectionData.db_url,
                  database: connectionData.database || connectionData.summary,
                  status: connectionData.status || 'connected',
                  latencyMs: connectionData.latency_ms,
                })
                addSavedConnection(restored)
                toast.show('Data source restored', 'success')
              } catch (restoreErr) {
                console.error('Failed to restore connection:', restoreErr)
                toast.show('Failed to restore connection', 'error')
              }
            }
          },
          { severity: 'info' }
        )
      },
    })
  }, [deletingConnection, savedConnections, removeSavedConnection, setSavedConnections, toast, execute])

  const handleSaveConnection = useCallback(async (connectionData) => {
    const isEditing = !!editingConnection

    // UX Governance: Create/Update action with tracking
    execute({
      type: isEditing ? InteractionType.UPDATE : InteractionType.CREATE,
      label: isEditing ? `Update data source "${connectionData.name}"` : `Add data source "${connectionData.name}"`,
      reversibility: Reversibility.FULLY_REVERSIBLE,
      successMessage: isEditing ? 'Data source updated' : 'Data source added',
      errorMessage: 'Failed to save connection',
      action: async () => {
        setLoading(true)
        try {
          const result = await api.testConnection(connectionData)
          if (!result.ok) {
            throw new Error(result.detail || 'Connection test failed')
          }

          const savedConnection = await api.upsertConnection({
            id: editingConnection?.id || result.connection_id,
            name: connectionData.name,
            dbType: connectionData.db_type,
            dbUrl: connectionData.db_url,
            database: connectionData.database,
            status: 'connected',
            latencyMs: result.latency_ms,
          })

          addSavedConnection(savedConnection)
          drawerOpenRef.current = false
          setDrawerOpen(false)
        } finally {
          setLoading(false)
        }
      },
    })
  }, [editingConnection, addSavedConnection, execute])

  const handleTestConnection = useCallback(async (connection) => {
    // UX Governance: Execute action with tracking
    execute({
      type: InteractionType.EXECUTE,
      label: `Test connection "${connection.name}"`,
      reversibility: Reversibility.SYSTEM_MANAGED,
      errorMessage: 'Connection test failed',
      action: async () => {
        setLoading(true)
        try {
          const result = await api.healthcheckConnection(connection.id)
          if (result.status === 'ok') {
            toast.show(`Connected (${result.latency_ms}ms)`, 'success')
          } else {
            throw new Error('Connection unavailable')
          }
        } finally {
          setLoading(false)
        }
      },
    })
  }, [toast, execute])

  const handleRowClick = useCallback((row) => {
    setActiveConnectionId(row.id)
    toast.show(`Selected: ${row.name}`, 'info')
  }, [setActiveConnectionId, toast])

  const columns = useMemo(() => [
    {
      field: 'name',
      headerName: 'Name',
      minWidth: 200,
      flex: 1, // Take remaining space but ensure minimum width
      renderCell: (value, row) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FavoriteButton
            entityType="connections"
            entityId={row.id}
            initialFavorite={favorites.has(row.id)}
            onToggle={(isFav) => handleFavoriteToggle(row.id, isFav)}
          />
          <IconContainer
            sx={{
              bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
            }}
          >
            <StorageIcon sx={{ color: theme.palette.text.secondary, fontSize: 16 }} />
          </IconContainer>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Box data-testid="connection-name" sx={{ fontWeight: 500, fontSize: '14px', color: theme.palette.text.primary }}>
                {value}
              </Box>
              {activeConnectionId === row.id && (
                <Chip size="small" label="Active" sx={{ bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.1) : neutral[200], color: 'text.secondary' }} />
              )}
            </Stack>
            <Box sx={{ fontSize: '0.75rem', color: theme.palette.text.secondary }}>
              {row.summary || row.db_type}
            </Box>
          </Box>
        </Box>
      ),
    },
    {
      field: 'db_type',
      headerName: 'Type',
      width: 120,
      renderCell: (value) => {
        const typeLabels = { sqlite: 'SQLite', postgresql: 'PostgreSQL', postgres: 'PostgreSQL', mysql: 'MySQL', mssql: 'SQL Server', oracle: 'Oracle', csv: 'CSV', excel: 'Excel', json: 'JSON' }
        return (
          <Chip
            label={typeLabels[(value || '').toLowerCase()] || value || 'Unknown'}
            size="small"
            data-testid="connection-db-type"
            sx={{
              bgcolor: theme.palette.mode === 'dark' ? alpha(theme.palette.text.primary, 0.08) : neutral[100],
              color: theme.palette.text.secondary,
              fontSize: '0.75rem',
              borderRadius: 1,  // Figma spec: 8px
            }}
          />
        )
      },
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 140,
      renderCell: (value) => {
        const isConnected = value === 'connected'
        return (
          <Chip
            icon={isConnected
              ? <CheckCircleIcon sx={{ fontSize: 14 }} />
              : <ErrorIcon sx={{ fontSize: 14 }} />
            }
            label={value || 'Unknown'}
            size="small"
            data-testid="connection-status"
            sx={{
              fontSize: '0.75rem',
              textTransform: 'capitalize',
              borderRadius: 1,  // Figma spec: 8px
              bgcolor: isConnected
                ? alpha(statusColors.success, 0.1)
                : alpha(statusColors.destructive, 0.1),
              color: isConnected
                ? statusColors.success
                : statusColors.destructive,
              '& .MuiChip-icon': {
                color: 'inherit',
              },
            }}
          />
        )
      },
    },
    {
      field: 'lastLatencyMs',
      headerName: 'Latency',
      width: 100,
      renderCell: (value) => (
        <Box data-testid="connection-latency" sx={{ color: theme.palette.text.secondary, fontSize: '14px' }}>
          {value ? `${value}ms` : '-'}
        </Box>
      ),
    },
    {
      field: 'lastConnected',
      headerName: 'Last Connected',
      width: 160,
      renderCell: (value) => {
        if (!value) return <Box sx={{ color: theme.palette.text.disabled, fontSize: '14px' }}>-</Box>
        const d = new Date(value)
        const now = new Date()
        const diffMs = now - d
        const diffMin = Math.floor(diffMs / 60000)
        const diffHr = Math.floor(diffMs / 3600000)
        const diffDay = Math.floor(diffMs / 86400000)
        let relative
        if (diffMin < 1) relative = 'Just now'
        else if (diffMin < 60) relative = `${diffMin}m ago`
        else if (diffHr < 24) relative = `${diffHr}h ago`
        else if (diffDay < 7) relative = `${diffDay}d ago`
        else relative = d.toLocaleDateString()
        return (
          <Tooltip title={d.toLocaleString()} arrow>
            <Box data-testid="connection-last-connected" sx={{ color: theme.palette.text.secondary, fontSize: '14px', cursor: 'default' }}>
              {relative}
            </Box>
          </Tooltip>
        )
      },
    },
  ], [favorites, handleFavoriteToggle, theme, activeConnectionId])

  const filters = useMemo(() => [
    {
      key: 'status',
      label: 'Status',
      options: [
        { value: 'connected', label: 'Connected' },
        { value: 'disconnected', label: 'Disconnected' },
        { value: 'error', label: 'Error' },
      ],
    },
    {
      key: 'db_type',
      label: 'Type',
      options: [
        { value: 'sqlite', label: 'SQLite' },
        { value: 'postgresql', label: 'PostgreSQL' },
      ],
    },
  ], [])

  return (
    <PageContainer>
      <Alert severity="info" sx={{ mb: 2, borderRadius: 1 }}>
        Data sources power report runs and AI tools. Use a read-only account when possible. Active sources are labeled
        and can be switched anytime.
      </Alert>
      <DataTable
        title="Data Sources"
        subtitle="Connect to your databases and data files"
        columns={columns}
        data={savedConnections}
        loading={loading}
        searchPlaceholder="Search connections..."
        filters={filters}
        actions={[
          {
            label: 'Add Data Source',
            icon: <AddIcon sx={{ fontSize: 18 }} />,
            variant: 'contained',
            onClick: handleAddConnection,
          },
        ]}
        onRowClick={handleRowClick}
        rowActions={(row) => (
          <Tooltip title="More actions">
            <ActionButton
              size="small"
              onClick={(e) => handleOpenMenu(e, row)}
              aria-label="More actions"
              data-testid="connection-actions-button"
              sx={{ color: theme.palette.text.secondary }}
            >
              <MoreVertIcon sx={{ fontSize: 18 }} />
            </ActionButton>
          </Tooltip>
        )}
        emptyState={{
          icon: StorageIcon,
          title: 'No data sources yet',
          description: 'Connect to a database to start pulling data for your reports.',
          actionLabel: 'Add Data Source',
          onAction: handleAddConnection,
        }}
      />

      {/* Row Actions Menu */}
      <StyledMenu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleCloseMenu}
      >
        <StyledMenuItem
          onClick={() => { handleTestConnection(menuConnection); handleCloseMenu() }}
        >
          <ListItemIcon>
            <RefreshIcon sx={{ fontSize: 16, color: theme.palette.text.secondary }} />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '14px' }}>
            Test Connection
          </ListItemText>
        </StyledMenuItem>
        <StyledMenuItem onClick={handleSchemaInspect}>
          <ListItemIcon>
            <TableViewIcon sx={{ fontSize: 16, color: theme.palette.text.secondary }} />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '14px' }}>
            Inspect Schema
          </ListItemText>
        </StyledMenuItem>
        <StyledMenuItem onClick={handleEditConnection}>
          <ListItemIcon>
            <EditIcon sx={{ fontSize: 16, color: theme.palette.text.secondary }} />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '14px' }}>
            Edit
          </ListItemText>
        </StyledMenuItem>
        <StyledMenuItem
          onClick={handleDeleteClick}
          sx={{ color: theme.palette.text.primary }}
        >
          <ListItemIcon>
            <DeleteIcon sx={{ fontSize: 16, color: theme.palette.text.secondary }} />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: '14px' }}>
            Delete
          </ListItemText>
        </StyledMenuItem>
      </StyledMenu>

      {/* Connection Form Drawer */}
      <Drawer
        open={drawerOpen}
        onClose={() => { drawerOpenRef.current = false; setDrawerOpen(false) }}
        title={editingConnection ? 'Edit Data Source' : 'Add Data Source'}
        subtitle="Enter your database details to connect"
        width={520}
      >
        <ConnectionForm
          connection={editingConnection}
          onSave={handleSaveConnection}
          onCancel={() => { drawerOpenRef.current = false; setDrawerOpen(false) }}
          loading={loading}
        />
      </Drawer>

      {/* Delete Confirmation */}
      <ConfirmModal
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Remove Data Source"
        message={`Remove "${deletingConnection?.name}"? This only removes it from NeuraReport and does not change your database. You can undo this within a few seconds.`}
        confirmLabel="Remove"
        severity="error"
        loading={loading}
      />

      <ConnectionSchemaDrawer
        open={schemaOpen}
        onClose={() => setSchemaOpen(false)}
        connection={schemaConnection}
      />
    </PageContainer>
  )
}
