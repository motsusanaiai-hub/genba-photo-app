/** <video> の現在のフレームを JPEG Blob として切り出す（オーバーレイは含まない） */
export async function captureVideoFrame(video: HTMLVideoElement, quality = 0.92): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context not available')
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      quality,
    )
  })
}

export function blobToFile(blob: Blob, filename: string): File {
  return new File([blob], filename, { type: blob.type })
}
