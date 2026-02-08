import { useEffect, useState } from 'react'
import { readFile } from '../lib/api'
import { useWebSocket } from '../lib/ws'

interface Asset {
  name: string
  status: string
  url?: string
}

interface AssetGalleryProps {
  slug: string
}

export default function AssetGallery({ slug }: AssetGalleryProps) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(false)
  const ws = useWebSocket()

  const loadAssets = async () => {
    try {
      setLoading(true)
      const assetsJsonPath = `assets/${slug}/assets.json`
      const data = await readFile(slug, assetsJsonPath)

      if (data) {
        try {
          const parsed = JSON.parse(data)
          setAssets(Array.isArray(parsed) ? parsed : [])
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
  }

  useEffect(() => {
    loadAssets()
  }, [slug])

  useEffect(() => {
    const unsubscribe = ws.subscribe('file-changed', (event) => {
      if (event.slug === slug && event.path?.includes('assets')) {
        loadAssets()
      }
    })
    return unsubscribe
  }, [slug, ws])

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-gray-700 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-200">Assets</h3>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="text-gray-400 text-sm">Loading assets...</div>
        ) : assets.length > 0 ? (
          <div className="space-y-2">
            {assets.map((asset, idx) => (
              <div
                key={idx}
                className="p-2 bg-gray-700 rounded text-xs border border-gray-600"
              >
                <div className="font-mono text-gray-300 truncate">
                  {asset.name}
                </div>
                <div className="text-gray-500 text-xs mt-1">{asset.status}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-500 text-sm italic">
            Assets will appear here after the collect stage
          </div>
        )}
      </div>
    </div>
  )
}
