import { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Upload, X, Image } from 'lucide-react';

interface PosterUploadProps {
  currentUrl: string;
  onUrlChange: (url: string) => void;
  folder: string; // e.g. 'movies', 'events', 'concerts'
  /** Field label. Defaults to the poster wording this started life with. */
  label?: string;
  /**
   * Sizing for the preview box and the empty dropzone, as Tailwind classes.
   * Defaults to a 2:3 poster thumbnail; press photos are landscape, so they
   * pass their own.
   */
  previewClassName?: string;
  /** Alt text for the preview image. */
  alt?: string;
}

export function PosterUpload({
  currentUrl,
  onUrlChange,
  folder,
  label = 'Poster Image',
  previewClassName = 'w-32 aspect-[2/3]',
  alt = 'Movie poster preview',
}: PosterUploadProps) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    setUploading(true);
    const ext = file.name.split('.').pop();
    const path = `${folder}/${Date.now()}.${ext}`;

    const { error } = await supabase.storage.from('posters').upload(path, file);
    if (error) {
      toast.error('Upload failed: ' + error.message);
      setUploading(false);
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from('posters').getPublicUrl(path);
    onUrlChange(publicUrl);
    setUploading(false);
    // Deliberately not "Poster uploaded" — this component also carries the
    // Press page's banner photo and article thumbnails now.
    toast.success('Image uploaded');
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {currentUrl ? (
        <div className={`relative ${previewClassName} rounded-lg overflow-hidden bg-secondary`}>
          <img src={currentUrl} alt={alt} className="w-full h-full object-cover" />
          <button
            type="button"
            onClick={() => onUrlChange('')}
            aria-label="Remove poster"
            className="absolute top-1 right-1 p-1 rounded-full bg-background/80 hover:bg-background text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <div
          onClick={() => fileRef.current?.click()}
          className={`${previewClassName} rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-primary/50 transition-colors`}
        >
          <Image className="h-6 w-6 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Upload</span>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
      <div className="flex gap-2">
        {!currentUrl && (
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Upload className="h-3 w-3 mr-1" />
            {uploading ? 'Uploading...' : 'Choose File'}
          </Button>
        )}
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Or paste URL</Label>
        <Input
          value={currentUrl}
          onChange={e => onUrlChange(e.target.value)}
          placeholder="https://..."
          className="text-xs"
        />
      </div>
    </div>
  );
}
