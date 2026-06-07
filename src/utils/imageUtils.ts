export interface ThumbnailResult {
  dataUrl: string
  width: number | null
  height: number | null
}

/** Canvas で最大 maxWidth px のサムネイルを生成して data URL を返す */
export async function generateThumbnail(
  file: File,
  maxWidth = 300,
): Promise<ThumbnailResult> {
  try {
    const img = await loadImage(file)
    const ratio = Math.min(1, maxWidth / img.naturalWidth)
    const w = Math.round(img.naturalWidth * ratio)
    const h = Math.round(img.naturalHeight * ratio)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    URL.revokeObjectURL(img.src)
    return {
      dataUrl: canvas.toDataURL('image/webp', 0.75),
      width: img.naturalWidth,
      height: img.naturalHeight,
    }
  } catch {
    // HEIC など未対応フォーマットのフォールバック
    return { dataUrl: makePlaceholderDataUrl(file.name), width: null, height: null }
  }
}

/**
 * Excel 出力用に 600px JPEG Blob を生成する。
 * 画像読み込みに失敗した場合（HEIC 等）は null を返す。
 */
export async function generateCompressedImage(file: File): Promise<Blob | null> {
  try {
    const img = await loadImage(file)
    const maxPx = 600
    const ratio = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.round(img.naturalWidth * ratio)
    const h = Math.round(img.naturalHeight * ratio)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85)
    URL.revokeObjectURL(img.src)
    return blob
  } catch {
    return null
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Cannot load: ${file.name}`))
    img.src = URL.createObjectURL(file)
  })
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      type,
      quality,
    )
  })
}

/** 画像を読み込めなかったときのプレースホルダー SVG */
function makePlaceholderDataUrl(filename: string): string {
  const initial = filename[0]?.toUpperCase() ?? '?'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
    <rect width="300" height="300" fill="#e5e7eb"/>
    <text x="150" y="165" font-size="100" text-anchor="middle" fill="#9ca3af">${initial}</text>
  </svg>`
  return `data:image/svg+xml;base64,${btoa(svg)}`
}
