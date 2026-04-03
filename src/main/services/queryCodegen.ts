import type { CodegenInput, CodegenLanguage } from '@shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(obj: unknown): string {
  return JSON.stringify(obj, null, 2)
}

function fmtPython(obj: unknown): string {
  return fmt(obj)
    .replace(/\btrue\b/g, 'True')
    .replace(/\bfalse\b/g, 'False')
    .replace(/\bnull\b/g, 'None')
}

function fmtJavaEscaped(obj: unknown): string {
  return fmt(obj).replace(/"/g, '\\"')
}

function fmtCSharpLiteral(obj: unknown): string {
  // Use C# verbatim string: double quotes become ""
  return fmt(obj).replace(/"/g, '""')
}

// ---------------------------------------------------------------------------
// JavaScript / Node.js
// ---------------------------------------------------------------------------

function generateJavaScript(input: CodegenInput): string {
  const { database, collection, includeBoilerplate } = input
  const lines: string[] = []

  if (includeBoilerplate) {
    lines.push(`const { MongoClient } = require('mongodb')`)
    lines.push(``)
    lines.push(`async function main() {`)
    lines.push(`  const client = new MongoClient('mongodb://localhost:27017')`)
    lines.push(`  await client.connect()`)
    lines.push(`  const db = client.db('${database}')`)
    lines.push(`  const collection = db.collection('${collection}')`)
    lines.push(``)
  } else {
    lines.push(`// Assumes 'collection' is already defined`)
    lines.push(``)
  }

  const indent = includeBoilerplate ? '  ' : ''

  if (input.type === 'find') {
    const filter = input.filter && Object.keys(input.filter).length > 0 ? input.filter : {}
    lines.push(`${indent}const filter = ${fmt(filter)}`)
    if (input.projection && Object.keys(input.projection).length > 0) {
      lines.push(`${indent}const projection = ${fmt(input.projection)}`)
    }
    if (input.sort && Object.keys(input.sort).length > 0) {
      lines.push(`${indent}const sort = ${fmt(input.sort)}`)
    }
    lines.push(``)
    let cursor = `${indent}const cursor = collection.find(filter)`
    if (input.projection && Object.keys(input.projection).length > 0) {
      cursor += `.project(projection)`
    }
    if (input.sort && Object.keys(input.sort).length > 0) {
      cursor += `.sort(sort)`
    }
    if (input.skip && input.skip > 0) {
      cursor += `.skip(${input.skip})`
    }
    if (input.limit && input.limit > 0) {
      cursor += `.limit(${input.limit})`
    }
    lines.push(cursor)
    lines.push(`${indent}const results = await cursor.toArray()`)
    lines.push(`${indent}console.log(results)`)
  } else {
    const pipeline = input.pipeline ?? []
    lines.push(`${indent}const pipeline = ${fmt(pipeline)}`)
    lines.push(``)
    lines.push(`${indent}const results = await collection.aggregate(pipeline).toArray()`)
    lines.push(`${indent}console.log(results)`)
  }

  if (includeBoilerplate) {
    lines.push(``)
    lines.push(`  await client.close()`)
    lines.push(`}`)
    lines.push(``)
    lines.push(`main().catch(console.error)`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Python / pymongo
// ---------------------------------------------------------------------------

function generatePython(input: CodegenInput): string {
  const { database, collection, includeBoilerplate } = input
  const lines: string[] = []

  if (includeBoilerplate) {
    lines.push(`from pymongo import MongoClient`)
    lines.push(``)
    lines.push(`client = MongoClient('mongodb://localhost:27017')`)
    lines.push(`db = client['${database}']`)
    lines.push(`collection = db['${collection}']`)
    lines.push(``)
  } else {
    lines.push(`# Assumes 'collection' is already defined`)
    lines.push(``)
  }

  if (input.type === 'find') {
    const filter = input.filter && Object.keys(input.filter).length > 0 ? input.filter : {}
    lines.push(`filter = ${fmtPython(filter)}`)
    if (input.projection && Object.keys(input.projection).length > 0) {
      lines.push(`projection = ${fmtPython(input.projection)}`)
    }
    if (input.sort && Object.keys(input.sort).length > 0) {
      const sortList = Object.entries(input.sort)
        .map(([k, v]) => `('${k}', ${v})`)
        .join(', ')
      lines.push(`sort = [${sortList}]`)
    }
    lines.push(``)
    let findCall = `results = list(collection.find(filter`
    if (input.projection && Object.keys(input.projection).length > 0) {
      findCall += `, projection`
    }
    findCall += `)`
    if (input.sort && Object.keys(input.sort).length > 0) {
      findCall += `.sort(sort)`
    }
    if (input.skip && input.skip > 0) {
      findCall += `.skip(${input.skip})`
    }
    if (input.limit && input.limit > 0) {
      findCall += `.limit(${input.limit})`
    }
    findCall += `)`
    lines.push(findCall)
    lines.push(``)
    lines.push(`for doc in results:`)
    lines.push(`    print(doc)`)
  } else {
    const pipeline = input.pipeline ?? []
    lines.push(`pipeline = ${fmtPython(pipeline)}`)
    lines.push(``)
    lines.push(`results = list(collection.aggregate(pipeline))`)
    lines.push(``)
    lines.push(`for doc in results:`)
    lines.push(`    print(doc)`)
  }

  if (includeBoilerplate) {
    lines.push(``)
    lines.push(`client.close()`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Java / MongoDB Driver
// ---------------------------------------------------------------------------

function generateJava(input: CodegenInput): string {
  const { database, collection, includeBoilerplate } = input
  const lines: string[] = []

  if (includeBoilerplate) {
    lines.push(`import com.mongodb.client.MongoClient;`)
    lines.push(`import com.mongodb.client.MongoClients;`)
    lines.push(`import com.mongodb.client.MongoCollection;`)
    lines.push(`import com.mongodb.client.MongoDatabase;`)
    lines.push(`import com.mongodb.client.model.Aggregates;`)
    lines.push(`import com.mongodb.client.model.Filters;`)
    lines.push(`import org.bson.Document;`)
    lines.push(`import java.util.Arrays;`)
    lines.push(`import java.util.List;`)
    lines.push(``)
    lines.push(`public class MongoQuery {`)
    lines.push(`    public static void main(String[] args) {`)
    lines.push(`        try (MongoClient client = MongoClients.create("mongodb://localhost:27017")) {`)
    lines.push(`            MongoDatabase db = client.getDatabase("${database}");`)
    lines.push(`            MongoCollection<Document> collection = db.getCollection("${collection}");`)
    lines.push(``)
  } else {
    lines.push(`// Assumes 'collection' is already defined`)
    lines.push(``)
  }

  const indent = includeBoilerplate ? '            ' : ''

  if (input.type === 'find') {
    const filter = input.filter && Object.keys(input.filter).length > 0 ? input.filter : {}
    lines.push(`${indent}Document filter = Document.parse("${fmtJavaEscaped(filter)}");`)
    let findCall = `${indent}collection.find(filter)`
    if (input.projection && Object.keys(input.projection).length > 0) {
      lines.push(`${indent}Document projection = Document.parse("${fmtJavaEscaped(input.projection)}");`)
      findCall += `.projection(projection)`
    }
    if (input.sort && Object.keys(input.sort).length > 0) {
      lines.push(`${indent}Document sort = Document.parse("${fmtJavaEscaped(input.sort)}");`)
      findCall += `.sort(sort)`
    }
    if (input.skip && input.skip > 0) {
      findCall += `.skip(${input.skip})`
    }
    if (input.limit && input.limit > 0) {
      findCall += `.limit(${input.limit})`
    }
    lines.push(``)
    lines.push(`${indent}${findCall}`)
    lines.push(`${indent}    .forEach(doc -> System.out.println(doc.toJson()));`)
  } else {
    const pipeline = input.pipeline ?? []
    lines.push(`${indent}List<Document> pipeline = Arrays.asList(`)
    pipeline.forEach((stage, i) => {
      const comma = i < pipeline.length - 1 ? ',' : ''
      lines.push(`${indent}    Document.parse("${fmtJavaEscaped(stage)}")${comma}`)
    })
    lines.push(`${indent});`)
    lines.push(``)
    lines.push(`${indent}collection.aggregate(pipeline)`)
    lines.push(`${indent}    .forEach(doc -> System.out.println(doc.toJson()));`)
  }

  if (includeBoilerplate) {
    lines.push(`        }`)
    lines.push(`    }`)
    lines.push(`}`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// C# / MongoDB.Driver
// ---------------------------------------------------------------------------

function generateCSharp(input: CodegenInput): string {
  const { database, collection, includeBoilerplate } = input
  const lines: string[] = []

  if (includeBoilerplate) {
    lines.push(`using MongoDB.Bson;`)
    lines.push(`using MongoDB.Driver;`)
    lines.push(``)
    lines.push(`var client = new MongoClient("mongodb://localhost:27017");`)
    lines.push(`var db = client.GetDatabase("${database}");`)
    lines.push(`var collection = db.GetCollection<BsonDocument>("${collection}");`)
    lines.push(``)
  } else {
    lines.push(`// Assumes 'collection' is already defined`)
    lines.push(``)
  }

  if (input.type === 'find') {
    const filter = input.filter && Object.keys(input.filter).length > 0 ? input.filter : {}
    lines.push(`var filter = BsonDocument.Parse(@"${fmtCSharpLiteral(filter)}");`)
    let findCall = `var cursor = collection.Find(filter)`
    if (input.projection && Object.keys(input.projection).length > 0) {
      lines.push(`var projection = BsonDocument.Parse(@"${fmtCSharpLiteral(input.projection)}");`)
      findCall += `.Project(projection)`
    }
    if (input.sort && Object.keys(input.sort).length > 0) {
      lines.push(`var sort = BsonDocument.Parse(@"${fmtCSharpLiteral(input.sort)}");`)
      findCall += `.Sort(sort)`
    }
    if (input.skip && input.skip > 0) {
      findCall += `.Skip(${input.skip})`
    }
    if (input.limit && input.limit > 0) {
      findCall += `.Limit(${input.limit})`
    }
    lines.push(``)
    lines.push(`${findCall};`)
    lines.push(``)
    lines.push(`var results = cursor.ToList();`)
    lines.push(`foreach (var doc in results)`)
    lines.push(`{`)
    lines.push(`    Console.WriteLine(doc.ToJson());`)
    lines.push(`}`)
  } else {
    const pipeline = input.pipeline ?? []
    lines.push(`var pipeline = new BsonDocument[]`)
    lines.push(`{`)
    pipeline.forEach((stage, i) => {
      const comma = i < pipeline.length - 1 ? ',' : ''
      lines.push(`    BsonDocument.Parse(@"${fmtCSharpLiteral(stage)}")${comma}`)
    })
    lines.push(`};`)
    lines.push(``)
    lines.push(`var results = collection.Aggregate<BsonDocument>(pipeline).ToList();`)
    lines.push(`foreach (var doc in results)`)
    lines.push(`{`)
    lines.push(`    Console.WriteLine(doc.ToJson());`)
    lines.push(`}`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// PHP / MongoDB\Client
// ---------------------------------------------------------------------------

function generatePHP(input: CodegenInput): string {
  const { database, collection, includeBoilerplate } = input
  const lines: string[] = []

  lines.push(`<?php`)
  lines.push(``)

  if (includeBoilerplate) {
    lines.push(`require 'vendor/autoload.php';`)
    lines.push(``)
    lines.push(`$client = new MongoDB\\Client('mongodb://localhost:27017');`)
    lines.push(`$collection = $client->${database}->${collection};`)
    lines.push(``)
  } else {
    lines.push(`// Assumes '$collection' is already defined`)
    lines.push(``)
  }

  if (input.type === 'find') {
    const filter = input.filter && Object.keys(input.filter).length > 0 ? input.filter : {}
    lines.push(`$filter = json_decode('${JSON.stringify(filter)}', true);`)
    const options: string[] = []
    if (input.projection && Object.keys(input.projection).length > 0) {
      lines.push(`$projection = json_decode('${JSON.stringify(input.projection)}', true);`)
      options.push(`'projection' => $projection`)
    }
    if (input.sort && Object.keys(input.sort).length > 0) {
      lines.push(`$sort = json_decode('${JSON.stringify(input.sort)}', true);`)
      options.push(`'sort' => $sort`)
    }
    if (input.skip && input.skip > 0) {
      options.push(`'skip' => ${input.skip}`)
    }
    if (input.limit && input.limit > 0) {
      options.push(`'limit' => ${input.limit}`)
    }
    lines.push(``)
    if (options.length > 0) {
      lines.push(`$options = [`)
      options.forEach((opt, i) => {
        const comma = i < options.length - 1 ? ',' : ''
        lines.push(`    ${opt}${comma}`)
      })
      lines.push(`];`)
      lines.push(``)
      lines.push(`$cursor = $collection->find($filter, $options);`)
    } else {
      lines.push(`$cursor = $collection->find($filter);`)
    }
    lines.push(``)
    lines.push(`foreach ($cursor as $doc) {`)
    lines.push(`    echo json_encode($doc), PHP_EOL;`)
    lines.push(`}`)
  } else {
    const pipeline = input.pipeline ?? []
    lines.push(`$pipeline = json_decode('${JSON.stringify(pipeline)}', true);`)
    lines.push(``)
    lines.push(`$cursor = $collection->aggregate($pipeline);`)
    lines.push(``)
    lines.push(`foreach ($cursor as $doc) {`)
    lines.push(`    echo json_encode($doc), PHP_EOL;`)
    lines.push(`}`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Ruby / Mongo::Client
// ---------------------------------------------------------------------------

function generateRuby(input: CodegenInput): string {
  const { database, collection, includeBoilerplate } = input
  const lines: string[] = []

  if (includeBoilerplate) {
    lines.push(`require 'mongo'`)
    lines.push(``)
    lines.push(`client = Mongo::Client.new(['localhost:27017'], database: '${database}')`)
    lines.push(`collection = client[:${collection}]`)
    lines.push(``)
  } else {
    lines.push(`# Assumes 'collection' is already defined`)
    lines.push(``)
  }

  if (input.type === 'find') {
    const filter = input.filter && Object.keys(input.filter).length > 0 ? input.filter : {}
    lines.push(`filter = ${fmt(filter)}`)
    const options: string[] = []
    if (input.projection && Object.keys(input.projection).length > 0) {
      options.push(`projection: ${fmt(input.projection)}`)
    }
    if (input.sort && Object.keys(input.sort).length > 0) {
      options.push(`sort: ${fmt(input.sort)}`)
    }
    if (input.skip && input.skip > 0) {
      options.push(`skip: ${input.skip}`)
    }
    if (input.limit && input.limit > 0) {
      options.push(`limit: ${input.limit}`)
    }
    lines.push(``)
    if (options.length > 0) {
      lines.push(`results = collection.find(filter, ${options.join(', ')}).to_a`)
    } else {
      lines.push(`results = collection.find(filter).to_a`)
    }
    lines.push(``)
    lines.push(`results.each { |doc| puts doc }`)
  } else {
    const pipeline = input.pipeline ?? []
    lines.push(`pipeline = ${fmt(pipeline)}`)
    lines.push(``)
    lines.push(`results = collection.aggregate(pipeline).to_a`)
    lines.push(``)
    lines.push(`results.each { |doc| puts doc }`)
  }

  if (includeBoilerplate) {
    lines.push(``)
    lines.push(`client.close`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function generateCode(input: CodegenInput, language: CodegenLanguage): string {
  switch (language) {
    case 'javascript':
      return generateJavaScript(input)
    case 'python':
      return generatePython(input)
    case 'java':
      return generateJava(input)
    case 'csharp':
      return generateCSharp(input)
    case 'php':
      return generatePHP(input)
    case 'ruby':
      return generateRuby(input)
    default:
      return `// Unsupported language: ${language}`
  }
}
