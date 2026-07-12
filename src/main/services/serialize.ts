import { ObjectId, Binary, Decimal128, Long, Timestamp, UUID } from 'mongodb'

/**
 * Check if a value looks like an ObjectId (has a buffer property with 12 bytes
 * or has a toHexString method).
 */
function isObjectIdLike(val: unknown): val is { toHexString(): string; buffer?: Buffer } {
  if (val instanceof ObjectId) return true
  if (val && typeof val === 'object') {
    // Duck-type check: has toHexString method
    if ('toHexString' in val && typeof (val as any).toHexString === 'function') return true
    // Has a buffer property that's 12 bytes (raw ObjectId)
    if ('buffer' in val) {
      const buf = (val as any).buffer
      if (buf && (Buffer.isBuffer(buf) || (buf instanceof Uint8Array && buf.length === 12))) {
        return true
      }
    }
    // Has id property that's 12 bytes
    if ('id' in val) {
      const id = (val as any).id
      if (id && (Buffer.isBuffer(id) || (id instanceof Uint8Array && id.length === 12))) {
        return true
      }
    }
  }
  return false
}

function objectIdToHex(val: any): string {
  if (typeof val.toHexString === 'function') return val.toHexString()
  const buf = val.buffer || val.id
  if (Buffer.isBuffer(buf)) return buf.toString('hex')
  if (buf instanceof Uint8Array) return Buffer.from(buf).toString('hex')
  return String(val)
}

/**
 * Recursively converts MongoDB BSON types to JSON-safe representations.
 */
export function serializeDocument(doc: unknown): unknown {
  if (doc === null || doc === undefined) return doc

  // Primitives
  if (typeof doc === 'string' || typeof doc === 'number' || typeof doc === 'boolean') return doc

  // BSON types (check instanceof first, then duck-type)
  if (isObjectIdLike(doc)) return objectIdToHex(doc)
  if (doc instanceof Binary) return { $binary: doc.toString('base64'), $type: doc.sub_type.toString(16) }
  if (doc instanceof Decimal128) return doc.toString()
  if (doc instanceof Long) return doc.toNumber()
  if (doc instanceof Timestamp) return { $timestamp: { t: doc.getHighBits(), i: doc.getLowBits() } }
  if (doc instanceof UUID) return doc.toString()
  if (doc instanceof Date) return doc.toISOString()
  if (doc instanceof RegExp) return { $regex: doc.source, $options: doc.flags }

  // Arrays
  if (Array.isArray(doc)) {
    return doc.map(serializeDocument)
  }

  // Plain objects — recurse
  if (typeof doc === 'object') {
    // Check for BSON types that might not match instanceof (e.g. cross-realm)
    const proto = Object.getPrototypeOf(doc)
    const ctorName = proto?.constructor?.name

    // Log unrecognized types with buffer for debugging
    if ('buffer' in (doc as any) && !Array.isArray(doc)) {
      console.log('[serialize] Object with buffer:', ctorName, Object.keys(doc as any))
    }

    if (ctorName === 'ObjectId' || ctorName === 'ObjectID') {
      return objectIdToHex(doc)
    }
    if (ctorName === 'Decimal128') return String(doc)
    if (ctorName === 'Long') return Number(doc)
    if (ctorName === 'UUID') return String(doc)
    if (ctorName === 'Binary') {
      try {
        return { $binary: (doc as any).toString('base64'), $type: (doc as any).sub_type?.toString(16) || '0' }
      } catch {
        return String(doc)
      }
    }

    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
      result[key] = serializeDocument(value)
    }
    return result
  }

  return doc
}

export function serializeDocuments(docs: Record<string, unknown>[]): Record<string, unknown>[] {
  return docs.map((doc) => serializeDocument(doc) as Record<string, unknown>)
}

/**
 * Serialize a BSON document to relaxed Extended-JSON — every BSON type becomes
 * a marker ({ $oid }, { $date }, { $numberDecimal }, ...) that reviveExtended /
 * the import worker's deserialize() can turn back into real BSON.
 *
 * Unlike serializeDocument (which flattens ObjectId→hex-string, Date→ISO-string
 * for display/CSV and is therefore LOSSY), this is a lossless round-trip and is
 * what JSON/NDJSON exports use, so exporting then re-importing preserves types
 * instead of silently downgrading ObjectIds and dates to strings.
 */
export function serializeToEJSON(doc: unknown): unknown {
  if (doc === null || doc === undefined) return doc
  if (typeof doc === 'string' || typeof doc === 'number' || typeof doc === 'boolean') return doc

  // Concrete BSON classes first — UUID/Binary are Buffer-backed and would be
  // misdetected by the duck-typed isObjectIdLike, so check them before it.
  if (doc instanceof Date) return { $date: doc.toISOString() }
  if (doc instanceof Decimal128) return { $numberDecimal: doc.toString() }
  if (doc instanceof Long) return { $numberLong: doc.toString() }
  if (doc instanceof UUID) return { $uuid: doc.toString() }
  if (doc instanceof Binary) return { $binary: doc.toString('base64'), $type: doc.sub_type.toString(16) }
  if (doc instanceof Timestamp) return { $timestamp: { t: doc.getHighBits(), i: doc.getLowBits() } }
  if (doc instanceof RegExp) return { $regex: doc.source, $options: doc.flags }
  if (isObjectIdLike(doc)) return { $oid: objectIdToHex(doc) }

  if (Array.isArray(doc)) return doc.map(serializeToEJSON)

  if (typeof doc === 'object') {
    // Cross-realm BSON safety net, mirroring serializeDocument.
    const ctorName = Object.getPrototypeOf(doc)?.constructor?.name
    if (ctorName === 'ObjectId' || ctorName === 'ObjectID') return { $oid: objectIdToHex(doc) }
    if (ctorName === 'Decimal128') return { $numberDecimal: String(doc) }
    if (ctorName === 'Long') return { $numberLong: String(doc) }
    if (ctorName === 'UUID') return { $uuid: String(doc) }

    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
      result[key] = serializeToEJSON(value)
    }
    return result
  }

  return doc
}

/**
 * Revive Extended-JSON markers ({ $oid }, { $date }, ...) back into real BSON
 * types. This is the inverse of the shell-flavoured serialization the document
 * editor writes: the renderer parses `ObjectId("...")` into `{ $oid: "..." }`
 * (see renderer/lib/shellJson.ts) and this turns those markers into ObjectIds
 * etc. so edits preserve their BSON type instead of collapsing to strings.
 *
 * Plain values pass through unchanged, so it's safe to run over any update doc.
 */
export function reviveExtended(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(reviveExtended)

  const o = value as Record<string, any>
  if (typeof o.$oid === 'string') {
    try { return new ObjectId(o.$oid) } catch { return o.$oid }
  }
  if (o.$date !== undefined) {
    const d = new Date(o.$date)
    return Number.isNaN(d.getTime()) ? o.$date : d
  }
  if (typeof o.$numberDecimal === 'string') {
    try { return Decimal128.fromString(o.$numberDecimal) } catch { return o.$numberDecimal }
  }
  if (typeof o.$numberLong === 'string') {
    try { return Long.fromString(o.$numberLong) } catch { return o.$numberLong }
  }
  if (typeof o.$uuid === 'string') {
    try { return new UUID(o.$uuid) } catch { return o.$uuid }
  }
  if (typeof o.$binary === 'string' && o.$type !== undefined) {
    try { return new Binary(Buffer.from(o.$binary, 'base64'), parseInt(String(o.$type), 16)) } catch { return o.$binary }
  }
  if (o.$timestamp && typeof o.$timestamp === 'object') {
    try { return new Timestamp({ t: Number(o.$timestamp.t) || 0, i: Number(o.$timestamp.i) || 0 }) } catch { return o }
  }
  if (o.$regex !== undefined) {
    const pat = String(o.$regex)
    const flags = String(o.$options || '').replace(/[^gimsuy]/g, '')
    try { return new RegExp(pat, flags) } catch { return pat }
  }

  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) result[k] = reviveExtended(v)
  return result
}

/**
 * Render a raw BSON document as MongoDB "shell" text — ObjectId("..."),
 * ISODate("..."), NumberDecimal("..."), etc. — for the document editor, so the
 * user sees (and edits) the real types instead of flattened strings. The
 * renderer parses this back with parseShellDocument on save.
 */
export function serializeToShellSource(doc: unknown): string {
  return printShell(doc, 0)
}

function quote(s: string): string {
  return JSON.stringify(s)
}

function printShell(val: unknown, indent: number): string {
  const pad = '  '.repeat(indent)
  const padIn = '  '.repeat(indent + 1)

  if (val === null || val === undefined) return 'null'
  if (typeof val === 'string') return quote(val)
  if (typeof val === 'number') return String(val)
  if (typeof val === 'boolean') return String(val)

  // Concrete BSON classes before the duck-typed ObjectId check (UUID/Binary are
  // Buffer-backed and would otherwise be misread as ObjectIds).
  if (val instanceof Date) return `ISODate(${quote(val.toISOString())})`
  if (val instanceof Decimal128) return `NumberDecimal(${quote(val.toString())})`
  if (val instanceof Long) return `NumberLong(${quote(val.toString())})`
  if (val instanceof UUID) return `UUID(${quote(val.toString())})`
  if (val instanceof Binary) return `BinData(${val.sub_type}, ${quote(val.toString('base64'))})`
  if (val instanceof Timestamp) return `Timestamp(${val.getHighBits()}, ${val.getLowBits()})`
  // RegExp as a constructor call (parseShellDocument parses it back to a
  // $regex marker) — NOT a plain quoted string, which would round-trip the
  // regex field into a string and corrupt it on save.
  if (val instanceof RegExp) return `RegExp(${quote(val.source)}, ${quote(val.flags)})`
  if (isObjectIdLike(val)) return `ObjectId(${quote(objectIdToHex(val))})`

  if (Array.isArray(val)) {
    if (val.length === 0) return '[]'
    const items = val.map((v) => padIn + printShell(v, indent + 1))
    return `[\n${items.join(',\n')}\n${pad}]`
  }

  if (typeof val === 'object') {
    // Cross-realm BSON safety net, mirroring serializeDocument.
    const ctorName = Object.getPrototypeOf(val)?.constructor?.name
    if (ctorName === 'Decimal128') return `NumberDecimal(${quote(String(val))})`
    if (ctorName === 'Long') return `NumberLong(${quote(String(val))})`
    if (ctorName === 'UUID') return `UUID(${quote(String(val))})`

    const entries = Object.entries(val as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    const items = entries.map(([k, v]) => `${padIn}${quote(k)}: ${printShell(v, indent + 1)}`)
    return `{\n${items.join(',\n')}\n${pad}}`
  }

  return 'null'
}
