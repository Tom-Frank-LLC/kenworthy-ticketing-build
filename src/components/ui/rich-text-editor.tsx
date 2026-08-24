import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import {
  Bold,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Minus,
  Quote,
  RemoveFormatting,
  Type,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { isRichTextEmpty, toRichHtml } from '@/lib/richText';

/**
 * The formatting toolbar for admin description fields.
 *
 * Value in and out is an HTML string, so this drops straight into the existing
 * `description` state and the existing `TEXT` columns — no schema change, and
 * no migration for rows written before it shipped: `toRichHtml` turns legacy
 * plain text into paragraphs on the way in.
 *
 * **The toolbar is deliberately short.** Every mark it can apply is on the
 * allowlist in `src/lib/richText.ts`, and every mark on that allowlist is on
 * the toolbar. Adding a button without widening the allowlist gives staff
 * formatting that silently disappears when the page renders; widening the
 * allowlist without a button widens what a `/host` account can put on a public
 * page. They move together or not at all.
 */

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  /** Mirrors the `id` a <Label htmlFor> points at. */
  id?: string;
  placeholder?: string;
  /** Roughly how tall the writing area starts out, in lines. */
  rows?: number;
  className?: string;
  'aria-label'?: string;
}

/** Only h3 — see the note in `src/index.css` about not outranking a page's h1. */
const HEADING_LEVEL = 3 as const;

function ToolbarButton({
  label,
  icon: Icon,
  active,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof Bold;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      // `aria-pressed` rather than a visual-only highlight, so a screen reader
      // announces whether the cursor is already inside bold text.
      aria-pressed={active ?? false}
      aria-label={label}
      title={label}
      disabled={disabled}
      // Focus must not leave the document, or the mark would apply to nothing.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'disabled:opacity-50 disabled:pointer-events-none',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

function LinkControl({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState('');
  const inputId = useId();
  const active = editor.isActive('link');

  const apply = useCallback(() => {
    const raw = href.trim();
    if (!raw) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      setOpen(false);
      return;
    }
    // A staff member types `kenworthy.org/passes`, not `https://…`. Without a
    // scheme the browser reads it as a relative path and the sanitiser keeps
    // it as one, so the link would quietly point at our own 404.
    const url = /^(https?:|mailto:|tel:|\/|#)/i.test(raw) ? raw : `https://${raw}`;
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    setOpen(false);
  }, [editor, href]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setHref(editor.getAttributes('link').href ?? '');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Add or edit link"
          title="Add or edit link"
          aria-pressed={active}
          aria-expanded={open}
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            active
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Link2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2" align="start">
        <label htmlFor={inputId} className="text-xs text-muted-foreground">
          Link address
        </label>
        <Input
          id={inputId}
          value={href}
          onChange={(e) => setHref(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            }
          }}
          placeholder="kenworthy.org/film-passes"
          autoFocus
        />
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={apply}>
            Apply
          </Button>
          {active && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                setOpen(false);
              }}
            >
              <Link2Off className="h-4 w-4 mr-1" aria-hidden="true" /> Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Links to other sites open in a new tab.
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function RichTextEditor({
  value,
  onChange,
  id,
  placeholder,
  rows = 6,
  className,
  'aria-label': ariaLabel,
}: RichTextEditorProps) {
  // Guards the sync effect below: without it, every keystroke would round-trip
  // through the parent's state and reset the cursor to the end of the field.
  const emitted = useRef<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Marks with no toolbar button and no place on the render allowlist.
        // Leaving them enabled means a pasted `~~strike~~` or a stray Ctrl+E
        // produces formatting that vanishes the moment the page renders.
        code: false,
        codeBlock: false,
        strike: false,
        heading: { levels: [HEADING_LEVEL] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        // The real enforcement is the sanitiser at render; this only keeps the
        // editor's own markup consistent with what will eventually be printed.
        protocols: ['http', 'https', 'mailto', 'tel'],
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
    ],
    content: toRichHtml(value),
    editorProps: {
      attributes: {
        id: id ?? '',
        role: 'textbox',
        'aria-multiline': 'true',
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
        class: cn(
          'rich-text font-serif w-full px-3 py-2 focus:outline-none',
          'overflow-y-auto',
        ),
        style: `min-height:${rows * 1.6}em`,
      },
    },
    onUpdate({ editor: e }) {
      // Store nothing rather than `<p></p>` for a field the author emptied, so
      // every render site's `{description && …}` check keeps working.
      const html = isRichTextEmpty(e.getHTML()) ? '' : e.getHTML();
      emitted.current = html;
      onChange(html);
    },
  });

  // The admin forms fetch their row after mount and then set state, so the
  // first `value` this sees is almost always '' followed by the real copy.
  useEffect(() => {
    if (!editor) return;
    if (value === emitted.current) return;
    const next = toRichHtml(value);
    if (next === editor.getHTML()) return;
    editor.commands.setContent(next, false);
    emitted.current = value;
  }, [editor, value]);

  if (!editor) return null;

  const empty = editor.isEmpty;

  return (
    <div
      className={cn(
        'rounded-md border border-input bg-background',
        // Mirrors what the Input/Textarea siblings do, so a keyboard user sees
        // the same focus treatment on this field as on every other one.
        'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
        className,
      )}
    >
      <div
        role="toolbar"
        aria-label="Text formatting"
        aria-controls={id}
        className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1"
      >
        <ToolbarButton
          label="Bold"
          icon={Bold}
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="Italic"
          icon={Italic}
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="Sub-heading"
          icon={Type}
          active={editor.isActive('heading', { level: HEADING_LEVEL })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: HEADING_LEVEL }).run()
          }
        />
        <Separator orientation="vertical" className="mx-1 h-5" />
        <ToolbarButton
          label="Bulleted list"
          icon={List}
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          label="Numbered list"
          icon={ListOrdered}
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          label="Quote"
          icon={Quote}
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <Separator orientation="vertical" className="mx-1 h-5" />
        <LinkControl editor={editor} />
        <ToolbarButton
          label="Divider"
          icon={Minus}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        />
        <Separator orientation="vertical" className="mx-1 h-5" />
        <ToolbarButton
          label="Clear formatting"
          icon={RemoveFormatting}
          onClick={() =>
            editor.chain().focus().unsetAllMarks().clearNodes().run()
          }
        />
      </div>

      <div className="relative">
        {/* A real placeholder needs @tiptap/extension-placeholder and a
            ::before rule; one absolutely-positioned span costs less and reads
            the same. `aria-hidden` because the field already has its label. */}
        {empty && placeholder && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-2 font-serif text-muted-foreground"
          >
            {placeholder}
          </span>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export default RichTextEditor;
