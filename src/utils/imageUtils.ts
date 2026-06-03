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

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Cannot load: ${file.name}`))
    img.src = URL.createObjectURL(file)
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
