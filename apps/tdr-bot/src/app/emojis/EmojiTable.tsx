import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'

import type { EmojiView } from 'src/api/api.types'

import { DescriptionEditor } from './DescriptionEditor'
import {
  AnimatedChip,
  DeletedChip,
  Description,
  EmojiCard,
  type EmojiRowProps,
  RowActions,
} from './EmojiCard'
import { EmojiImage } from './EmojiImage'
import { formatWhen } from './format'
import { SourceChip } from './SourceChip'

const HEADERS = ['', 'Name', 'Description', 'Source', 'Model', 'Described', '']

function EmojiRow({
  emoji,
  editing,
  reconciling,
  redescribing,
  onEdit,
  onCloseEdit,
  onRedescribe,
}: EmojiRowProps) {
  return (
    <TableRow sx={{ verticalAlign: 'top', opacity: emoji.deletedAt ? 0.6 : 1 }}>
      <TableCell>
        <EmojiImage emoji={emoji} />
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" fontFamily="monospace">
            :{emoji.name}:
          </Typography>
          <AnimatedChip emoji={emoji} />
        </Box>
        {emoji.deletedAt && (
          <Box sx={{ mt: 0.75 }}>
            <DeletedChip emoji={emoji} />
          </Box>
        )}
      </TableCell>
      <TableCell sx={{ minWidth: 288, maxWidth: 384 }}>
        {editing ? (
          <DescriptionEditor emoji={emoji} onClose={onCloseEdit} />
        ) : (
          <Description emoji={emoji} reconciling={reconciling} />
        )}
      </TableCell>
      <TableCell>
        <SourceChip emoji={emoji} />
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
        {emoji.model ?? '—'}
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>
        {formatWhen(emoji.describedAt)}
      </TableCell>
      <TableCell>
        {!editing && (
          <RowActions
            emoji={emoji}
            redescribing={redescribing}
            onEdit={onEdit}
            onRedescribe={onRedescribe}
          />
        )}
      </TableCell>
    </TableRow>
  )
}

interface EmojiTableProps extends Omit<
  EmojiRowProps,
  'emoji' | 'editing' | 'redescribing'
> {
  emojis: EmojiView[]
  editingId: string | null
  redescribingId: string | null
}

/** A table from the `md` breakpoint up, stacked cards below it. */
export function EmojiTable({
  emojis,
  editingId,
  redescribingId,
  ...rest
}: EmojiTableProps) {
  return (
    <>
      <TableContainer
        component={Paper}
        variant="outlined"
        sx={{ display: { xs: 'none', md: 'block' } }}
      >
        <Table size="small">
          <TableHead>
            <TableRow>
              {HEADERS.map((h, i) => (
                <TableCell key={i} sx={{ whiteSpace: 'nowrap' }}>
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {emojis.map(emoji => (
              <EmojiRow
                key={emoji.id}
                emoji={emoji}
                editing={emoji.id === editingId}
                redescribing={emoji.id === redescribingId}
                {...rest}
              />
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack spacing={1.5} sx={{ display: { xs: 'flex', md: 'none' } }}>
        {emojis.map(emoji => (
          <EmojiCard
            key={emoji.id}
            emoji={emoji}
            editing={emoji.id === editingId}
            redescribing={emoji.id === redescribingId}
            {...rest}
          />
        ))}
      </Stack>
    </>
  )
}
