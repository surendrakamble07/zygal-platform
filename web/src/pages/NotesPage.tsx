import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/auth-context'
import { supabase } from '../lib/supabase'

interface EmployeeNote {
  id: string
  user_id: string
  note_date: string
  content: string
}

function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatNoteDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function NoteEditor({
  userId,
  date,
}: {
  userId: string
  date: string
}) {
  const queryClient = useQueryClient()
  const [content, setContent] = useState<string>()
  const [createdNoteId, setCreatedNoteId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saved'>('idle')
  const contentRef = useRef('')

  const note = useQuery({
    queryKey: ['employee-note', userId, date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_notes')
        .select('id, user_id, note_date, content')
        .eq('user_id', userId)
        .eq('note_date', date)
        .maybeSingle()
      if (error) throw error
      return data as EmployeeNote | null
    },
  })

  const saveNote = useMutation({
    mutationFn: async (vars: { content: string; noteId: string | null }) => {
      if (vars.noteId) {
        const { error } = await supabase
          .from('employee_notes')
          .update({ content: vars.content })
          .eq('id', vars.noteId)
          .eq('user_id', userId)
        if (error) throw error
        return vars.noteId
      }

      const { data, error } = await supabase
        .from('employee_notes')
        .insert({ user_id: userId, note_date: date, content: vars.content })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: (noteId, vars) => {
      setCreatedNoteId(noteId)
      if (contentRef.current === vars.content) setSaveState('saved')
      void queryClient.invalidateQueries({ queryKey: ['employee-notes', userId] })
    },
  })

  const { mutate: save, isPending, isError, reset } = saveNote
  const currentContent = content ?? note.data?.content ?? ''
  const currentNoteId = createdNoteId ?? note.data?.id ?? null

  useEffect(() => {
    if (!note.isSuccess || saveState !== 'dirty' || isPending || isError) return

    const timeout = window.setTimeout(() => {
      save({ content: currentContent, noteId: currentNoteId })
    }, 1500)
    return () => window.clearTimeout(timeout)
  }, [currentContent, currentNoteId, isError, isPending, note.isSuccess, save, saveState])

  function updateContent(value: string) {
    contentRef.current = value
    setContent(value)
    setSaveState('dirty')
    if (isError) reset()
  }

  function retrySave() {
    save({ content: currentContent, noteId: currentNoteId })
  }

  return (
    <section className="card">
      <div className="head-row">
        <div>
          <h2>{formatNoteDate(date)}</h2>
          <p className="muted small">Only you can see your notes.</p>
        </div>
        <span className="muted small" role="status" aria-live="polite">
          {note.isLoading
            ? 'Loading...'
            : isPending || saveState === 'dirty'
              ? 'Saving...'
              : isError
                ? 'Not saved'
                : saveState === 'saved'
                  ? 'Saved'
                  : note.data
                  ? 'Saved'
                  : ''}
        </span>
      </div>
      {note.isError && (
        <div className="banner error" role="alert">
          Could not load this note. Please try selecting the date again.
        </div>
      )}
      {isError && (
        <div className="banner error" role="alert">
          <span>Could not save your note.</span>
          <button type="button" className="link" onClick={retrySave}>
            Try again
          </button>
        </div>
      )}
      <label>
        Note
        <textarea
          rows={10}
          value={currentContent}
          onChange={(event) => updateContent(event.target.value)}
          placeholder="Write a note for this date..."
          disabled={!note.isSuccess || note.isError}
        />
      </label>
    </section>
  )
}

export default function NotesPage() {
  const { profile } = useAuth()
  const userId = profile?.id
  const today = localDateString(new Date())
  const [selectedDate, setSelectedDate] = useState(today)
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 29)
  const firstDate = localDateString(startDate)

  const notes = useQuery({
    queryKey: ['employee-notes', userId, firstDate, today],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_notes')
        .select('id, user_id, note_date, content')
        .eq('user_id', userId!)
        .gte('note_date', firstDate)
        .lte('note_date', today)
        .order('note_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as EmployeeNote[]
    },
  })

  if (!userId) return null

  return (
    <>
      <div>
        <h1>My Notes</h1>
        <p className="muted">A private notebook for your daily notes.</p>
      </div>

      <section className="card">
        <label>
          Note date
          <input
            type="date"
            value={selectedDate}
            onChange={(event) => {
              if (event.target.value) setSelectedDate(event.target.value)
            }}
          />
        </label>
      </section>

      <NoteEditor key={`${userId}-${selectedDate}`} userId={userId} date={selectedDate} />

      <section className="card">
        <div className="head-row">
          <h2>Recent notes</h2>
          <span className="muted small">Last 30 days</span>
        </div>
        {notes.isError && (
          <div className="banner error" role="alert">
            Could not load your recent notes.
          </div>
        )}
        {notes.isLoading && <p className="muted small">Loading notes...</p>}
        {!notes.isLoading && !notes.isError && notes.data?.length === 0 && (
          <p className="muted small">No notes in the last 30 days.</p>
        )}
        {!!notes.data?.length && (
          <div className="note-preview-list">
            {notes.data.map((item) => {
              const preview = item.content.trim()
              const truncated = preview.length > 60
              return (
                <button
                  type="button"
                  key={item.id}
                  className={`note-preview${selectedDate === item.note_date ? ' active' : ''}`}
                  onClick={() => setSelectedDate(item.note_date)}
                >
                  <span className="note-preview-date">{formatNoteDate(item.note_date)}</span>
                  <span className="note-preview-content">
                    {preview
                      ? `${preview.slice(0, 60)}${truncated ? '…' : ''}`
                      : 'No content'}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </section>
    </>
  )
}
