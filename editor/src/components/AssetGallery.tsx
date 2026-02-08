import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Upload } from 'lucide-react'
import { readFile, uploadAssets } from '../lib/api'
import { useWebSocket } from '../lib/ws'

interface Asset {
  name: string
  status: string
  url?: string
  file?: string
  type?: string
  size_bytes?: number
  originalName?: string
}

interface AssetGalleryProps {
  slug: string
}

function hasDraggedFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  return Array.from(dataTransfer.types || []).includes('Files') || dataTransfer.files.length > 0
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])

function getFilenameFromAssetPath(assetPath?: string): string | null {
  if (!assetPath) return null
  const parts = assetPath.split('/')
  const file = parts[parts.length - 1]
  if (!file || file.includes('\\')) return null
  return file
}

function isImageFile(filename: string): boolean {
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return false
  return IMAGE_EXTENSIONS.has(filename.slice(dot).toLowerCase())
}

export default function AssetGallery({ slug }: AssetGalleryProps) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const ws = useWebSocket()

  const loadAssets = useCallback(async () => {
    try {
      setLoading(true)
      const assetsJsonPath = `output/collect/${slug}/assets.json`
      const data = await readFile(slug, assetsJsonPath)

      if (data) {
        try {
          const parsed = JSON.parse(data)
          const raw = Array.isArray(parsed) ? parsed : (parsed.assets || [])
          const items = raw.map((a: any) => ({
            name: a.name || a.originalName || a.file || a.id || a.description || 'Untitled',
            status: a.status || 'unknown',
            url: a.url,
            file: a.file,
            type: a.type,
            size_bytes: a.size_bytes,
            originalName: a.originalName,
          }))
          setAssets(items)
        } catch {
          setAssets([])
        }
      } else {
        setAssets([])
      }
    } catch (error) {
      console.error('Failed to load assets:', error)
      setAssets([])
    } finally {
      setLoading(false)
    }
  }, [slug])

  const handleUpload = useCallback(async (files: File[]) => {
    if (files.length === 0) return

    try {
      setUploading(true)
      setError(null)
      await uploadAssets(slug, files)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      setError(message)
    } finally {
      setUploading(false)
    }
  }, [slug])

  const handleFileInputChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    await handleUpload(files)
    event.target.value = ''
  }, [handleUpload])

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    dragDepthRef.current += 1
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setIsDragOver(false)
    }
  }, [])

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
  }, [])

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDragOver(false)
    const droppedFiles = Array.from(event.dataTransfer.files || [])
    void handleUpload(droppedFiles)
  }, [handleUpload])

  useEffect(() => {
    void loadAssets()
  }, [loadAssets])

  useEffect(() => {
    const unsubscribe = ws.subscribe('file-changed', (event) => {
      if (event.slug === slug && event.path?.includes('assets')) {
        void loadAssets()
      }
    })
    return unsubscribe
  }, [slug, ws, loadAssets])

  useEffect(() => {
    if (!error) return
    const timeout = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(timeout)
  }, [error])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const handlePaste = (event: ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items || [])
      const pastedImageFiles = items
        .filter((item) => item.type.startsWith('image/'))
        .map((item, index) => {
          const file = item.getAsFile()
          if (!file) return null
          if (file.name) return file
          const typeParts = file.type.split('/')
          const rawExt = typeParts[1] || 'png'
          const extension = rawExt.replace(/\+.*$/, '')
          return new File([file], `clipboard-${Date.now()}-${index}.${extension}`, { type: file.type })
        })
        .filter((file): file is File => file !== null)

      if (pastedImageFiles.length === 0) return
      event.preventDefault()
      void handleUpload(pastedImageFiles)
    }

    panel.addEventListener('paste', handlePaste)
    return () => panel.removeEventListener('paste', handlePaste)
  }, [handleUpload])

  return (
    <div
      ref={panelRef}
      tabIndex={0}
      data-testid="asset-gallery"
      className="relative flex flex-col h-full outline-none"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="border-b border-gray-700 px-4 py-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-200">Assets</h3>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded border border-gray-600 bg-gray-700 px-2.5 py-1 text-xs text-gray-200 hover:bg-gray-600 transition"
        >
          <Upload size={14} />
          Upload
        </button>
        <input
          ref={inputRef}
          data-testid="asset-upload-input"
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void handleFileInputChange(event)
          }}
        />
      </div>

      <div className="flex-1 overflow-auto p-4">
        {error && (
          <div
            role="alert"
            className="mb-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200"
          >
            {error}
          </div>
        )}

        {uploading && (
          <div className="mb-3 text-xs text-blue-300">Uploading...</div>
        )}

        {loading ? (
          <div className="text-gray-400 text-sm">Loading assets...</div>
        ) : assets.length > 0 ? (
          <div className="space-y-2">
            {assets.map((asset, idx) => (
              <div key={`${asset.file || asset.name}-${idx}`} className="p-2 bg-gray-700 rounded text-xs border border-gray-600">
                <div className="flex items-center gap-2">
                  {asset.file && getFilenameFromAssetPath(asset.file) && isImageFile(getFilenameFromAssetPath(asset.file)!) ? (
                    <img
                      className="h-10 w-10 rounded border border-gray-600 bg-gray-800 object-cover shrink-0"
                      src={`/api/posts/${slug}/assets/file/${encodeURIComponent(getFilenameFromAssetPath(asset.file)!)}`}
                      alt={asset.originalName || asset.name}
                    />
                  ) : null}
                  <div className="font-mono text-gray-300 truncate min-w-0">
                    {asset.originalName || asset.name}
                  </div>
                </div>
                <div className="text-gray-500 text-xs mt-1">{asset.status}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-500 text-sm italic">
            Drag &amp; drop images here, paste from clipboard, or click Upload
          </div>
        )}
      </div>

      {isDragOver && (
        <div
          data-testid="asset-drop-overlay"
          className="pointer-events-none absolute inset-4 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-blue-400 bg-blue-500/10 text-center"
        >
          <div className="text-sm font-semibold text-blue-200">Drop images here</div>
          <div className="text-xs text-blue-300 mt-1">or paste from clipboard</div>
        </div>
      )}
    </div>
  )
}
