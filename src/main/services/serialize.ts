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
