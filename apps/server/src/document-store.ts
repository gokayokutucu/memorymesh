import { Collection, Db, MongoClient } from "mongodb";

const MONGO_HOST = process.env.MONGO_HOST ?? "localhost";
const MONGO_PORT = process.env.MONGO_PORT ?? "27017";
const MONGO_DB = process.env.MONGO_DB ?? "memorymesh";
const COLLECTION = "documents";
const URI = `mongodb://${MONGO_HOST}:${MONGO_PORT}`;

interface IDocumentRecord {
  _id: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

let client: MongoClient | null = null;
let database: Db | null = null;
let collection: Collection<IDocumentRecord> | null = null;
let warned = false;

function warnOnce(error: unknown): void {
  if (!warned) {
    warned = true;
    console.warn("MongoDB document store unavailable, continuing without full-content storage:", error);
  }
}

async function getCollection(): Promise<Collection<IDocumentRecord> | null> {
  if (collection) {
    return collection;
  }

  try {
    if (!client) {
      client = new MongoClient(URI);
    }
    if (!database) {
      await client.connect();
      database = client.db(MONGO_DB);
    }
    collection = database.collection<IDocumentRecord>(COLLECTION);
    await collection.createIndex({ _id: 1 });
    return collection;
  } catch (error) {
    warnOnce(error);
    return null;
  }
}

export async function saveDocument(
  id: string,
  content: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const docCollection = await getCollection();
  if (!docCollection) {
    return;
  }

  try {
    await docCollection.updateOne(
      { _id: id },
      {
        $set: {
          content,
          metadata,
          created_at: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (error) {
    warnOnce(error);
  }
}

export async function getDocument(id: string): Promise<string | null> {
  const docCollection = await getCollection();
  if (!docCollection) {
    return null;
  }

  try {
    const doc = await docCollection.findOne(
      { _id: id },
      { projection: { content: 1 } }
    );
    return doc?.content ?? null;
  } catch (error) {
    warnOnce(error);
    return null;
  }
}

export async function getDocuments(ids: string[]): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  if (ids.length === 0) {
    return results;
  }

  const docCollection = await getCollection();
  if (!docCollection) {
    return results;
  }

  try {
    const docs = await docCollection
      .find({ _id: { $in: ids } }, { projection: { content: 1 } })
      .toArray();
    for (const doc of docs) {
      results.set(doc._id, doc.content);
    }
    return results;
  } catch (error) {
    warnOnce(error);
    return results;
  }
}
