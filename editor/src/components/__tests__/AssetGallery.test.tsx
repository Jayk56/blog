import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import AssetGallery from '../AssetGallery'

const mockReadFile = vi.fn()
const mockUploadAssets = vi.fn()
const mockSubscribe = vi.fn(() => vi.fn())

vi.mock('../../lib/api', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  uploadAssets: (...args: unknown[]) => mockUploadAssets(...args),
}))

vi.mock('../../lib/ws', () => ({
  useWebSocket: () => ({
    subscribe: mockSubscribe,
  }),
}))

function createImageFile(name = 'image.png') {
  return new File(['fake-image'], name, { type: 'image/png' })
}

async function renderGallery(props?: { onInsertAsset?: (text: string) => boolean }) {
  render(<AssetGallery slug="my-post" {...props} />)
  await waitFor(() => {
    expect(mockReadFile).toHaveBeenCalled()
  })
}

describe('AssetGallery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadFile.mockResolvedValue('')
    mockUploadAssets.mockResolvedValue({ uploaded: [] })
    mockSubscribe.mockReturnValue(vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('renders upload button in header', async () => {
    await renderGallery()
    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument()
  })

  test('shows drop zone overlay when dragging files over the component', async () => {
    await renderGallery()
    const panel = screen.getByTestId('asset-gallery')
    const file = createImageFile()

    fireEvent.dragEnter(panel, {
      dataTransfer: { files: [file], types: ['Files'] },
    })

    expect(screen.getByTestId('asset-drop-overlay')).toBeInTheDocument()
  })

  test('hides drop zone overlay when drag leaves', async () => {
    await renderGallery()
    const panel = screen.getByTestId('asset-gallery')
    const file = createImageFile()
    const dataTransfer = { files: [file], types: ['Files'] }

    fireEvent.dragEnter(panel, { dataTransfer })
    expect(screen.getByTestId('asset-drop-overlay')).toBeInTheDocument()

    fireEvent.dragLeave(panel, { dataTransfer })
    expect(screen.queryByTestId('asset-drop-overlay')).not.toBeInTheDocument()
  })

  test('calls uploadAssets when files are dropped', async () => {
    await renderGallery()
    const panel = screen.getByTestId('asset-gallery')
    const file = createImageFile('dropped.png')

    fireEvent.drop(panel, {
      dataTransfer: { files: [file], types: ['Files'] },
    })

    await waitFor(() => {
      expect(mockUploadAssets).toHaveBeenCalledWith('my-post', [file])
    })
  })

  test('calls uploadAssets when files are selected via file picker', async () => {
    await renderGallery()
    const input = screen.getByTestId('asset-upload-input')
    const file = createImageFile('picker.png')

    fireEvent.change(input, {
      target: { files: [file] },
    })

    await waitFor(() => {
      expect(mockUploadAssets).toHaveBeenCalledWith('my-post', [file])
    })
  })

  test('displays error message on upload failure and auto-dismisses after 5 seconds', async () => {
    mockUploadAssets.mockRejectedValueOnce(new Error('Upload failed'))

    await renderGallery()
    vi.useFakeTimers()
    const input = screen.getByTestId('asset-upload-input')
    const file = createImageFile('broken.png')

    fireEvent.change(input, {
      target: { files: [file] },
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByRole('alert')).toHaveTextContent('Upload failed')

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('renders image thumbnails for assets with file field', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({
      assets: [
        {
          id: 'upload-1',
          status: 'success',
          file: 'assets/photo.png',
          originalName: 'Photo.png',
        },
      ],
    }))

    await renderGallery()

    const image = await screen.findByRole('img', { name: 'Photo.png' })
    expect(image).toHaveAttribute('src', '/api/posts/my-post/assets/file/photo.png')
  })

  test('shows updated empty state message when no assets exist', async () => {
    mockReadFile.mockResolvedValueOnce('')
    await renderGallery()

    expect(
      await screen.findByText('Drag & drop images here, paste from clipboard, or click Upload')
    ).toBeInTheDocument()
  })

  test('shows Insert button when onInsertAsset prop is provided and asset has a file', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({
      assets: [
        { id: 'upload-1', status: 'success', file: 'assets/photo.png', originalName: 'Photo.png' },
      ],
    }))

    await renderGallery({ onInsertAsset: vi.fn(() => true) })

    expect(screen.getByTestId('insert-asset-0')).toHaveTextContent('Insert')
  })

  test('does not show Insert button when onInsertAsset is not provided', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({
      assets: [
        { id: 'upload-1', status: 'success', file: 'assets/photo.png', originalName: 'Photo.png' },
      ],
    }))

    await renderGallery()

    expect(screen.queryByTestId('insert-asset-0')).not.toBeInTheDocument()
  })

  test('calls onInsertAsset with Hugo figure shortcode when Insert is clicked', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({
      assets: [
        { id: 'upload-1', status: 'success', file: 'assets/photo.png', originalName: 'Photo.png' },
      ],
    }))

    const onInsertAsset = vi.fn(() => true)
    await renderGallery({ onInsertAsset })

    fireEvent.click(screen.getByTestId('insert-asset-0'))

    expect(onInsertAsset).toHaveBeenCalledWith(
      '{{< figure src="photo.png" alt="Photo.png" class="mx-auto" >}}\n'
    )
  })

  test('does not show Inserted confirmation when onInsertAsset returns false', async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({
      assets: [
        { id: 'upload-1', status: 'success', file: 'assets/photo.png', originalName: 'Photo.png' },
      ],
    }))

    const onInsertAsset = vi.fn(() => false)
    await renderGallery({ onInsertAsset })

    fireEvent.click(screen.getByTestId('insert-asset-0'))

    expect(onInsertAsset).toHaveBeenCalled()
    expect(screen.getByTestId('insert-asset-0')).toHaveTextContent('Insert')
    expect(screen.queryByText('Inserted!')).not.toBeInTheDocument()
  })
})
