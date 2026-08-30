/**
 * Server-side Whisper proxy for the prompt bar's dictation button.
 *
 * The OpenAI key must never reach the browser, so the audio comes here and the
 * server forwards it. The key is read per-request rather than at module load so
 * a misconfigured deploy degrades to a clear 503 instead of a build error.
 */
export async function POST(request: Request): Promise<Response> {
  const key = process.env.OPENAI_API_KEY
  if (!key) {
    return new Response('Transcription is not configured: OPENAI_API_KEY is missing on the server', { status: 503 })
  }

  const form = await request.formData().catch(() => null)
  const audio = form?.get('audio')
  if (!(audio instanceof Blob) || audio.size === 0) {
    return new Response('No audio provided', { status: 400 })
  }
  // The endpoint is public and every request bills the shared key, so cap the
  // clip at a few minutes of speech; the prompt bar never records more.
  if (audio.size > 6 * 1024 * 1024) {
    return new Response('Audio too large', { status: 413 })
  }

  const upstream = new FormData()
  upstream.append('file', audio, audio instanceof File ? audio.name : 'instruction.webm')
  upstream.append('model', 'whisper-1')

  // The translations endpoint always outputs ENGLISH, whatever language the
  // operator dictated in - the demo's interface language is English and a
  // Spanish dictation must not flip the prompt bar's language.
  const response = await fetch('https://api.openai.com/v1/audio/translations', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: upstream,
  })
  if (!response.ok) {
    return new Response(`Transcription failed with ${response.status}`, { status: 502 })
  }

  const body = await response.json() as { text?: string }
  return Response.json({ text: body.text ?? '' })
}
