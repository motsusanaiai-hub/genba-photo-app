import { vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

/** テーブルごとの応答（select の終端メソッド・await のどちらでもこれを返す）。 */
export type TableResponse = { data: unknown; error: unknown }

/**
 * service_role の Supabase クライアントの最小フェイク。
 * from(table) の eq 呼び出しを記録し、「どのユーザーで検索したか」をテストで確認できるようにする。
 */
export function createFakeSupabase(options: {
  user?: { id: string; email?: string } | null
  userError?: unknown
  tables?: Record<string, TableResponse>
  rpc?: Record<string, TableResponse>
}) {
  const eqCalls: Array<{ table: string; column: string; value: unknown }> = []

  const from = vi.fn((table: string) => {
    const response = options.tables?.[table] ?? { data: null, error: null }
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        eqCalls.push({ table, column, value })
        return builder
      },
      limit: () => Promise.resolve(response),
      single: () => Promise.resolve(response),
      maybeSingle: () => Promise.resolve(response),
      then: (resolve: (value: TableResponse) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(response).then(resolve, reject),
    }
    return builder
  })

  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: options.user ?? null },
        error: options.userError ?? null,
      })),
    },
    from,
    rpc: vi.fn(async (name: string, _args?: unknown) => options.rpc?.[name] ?? { data: null, error: null }),
  }

  return { client, eqCalls }
}

export function createRequest(init: {
  method?: string
  headers?: Record<string, string>
  body?: unknown
}): VercelRequest {
  return {
    method: init.method ?? 'POST',
    headers: init.headers ?? {},
    body: init.body,
  } as unknown as VercelRequest
}

export function createResponse() {
  const result: { statusCode: number | null; body: unknown } = { statusCode: null, body: undefined }
  const res = {
    status(code: number) {
      result.statusCode = code
      return res
    },
    json(body: unknown) {
      result.body = body
      return res
    },
  }
  return { res: res as unknown as VercelResponse, result }
}
