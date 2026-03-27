import { Collection, Db, MongoClient } from "mongodb";
import {
  executeWithRetry,
  isTransientMongoError,
} from "./resilience";

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
      await executeWithRetry(
        async () => client!.connect(),
        {
          store: "mongo",
          operation: "connect",
          isTransient: isTransientMongoError,
          transientFailureCode: "mongo_transient_failure",
        }
      );
      database = client.db(MONGO_DB);
    }
    collection = database.collection<IDocumentRecord>(COLLECTION);
    await executeWithRetry(
      async () => collection!.createIndex({ _id: 1 }),
      {
        store: "mongo",
        operation: "createIndex",
        isTransient: isTransientMongoError,
        transientFailureCode: "mongo_transient_failure",
      }
    );
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
): Promise<boolean> {
  const docCollection = await getCollection();
  if (!docCollection) {
    return false;
  }

  try {
    await executeWithRetry(
      async () =>
        docCollection.updateOne(
          { _id: id },
          {
            $set: {
              content,
              metadata,
              created_at: new Date(),
            },
          },
          { upsert: true }
        ),
      {
        store: "mongo",
        operation: "updateOne",
        isTransient: isTransientMongoError,
        transientFailureCode: "mongo_transient_failure",
      }
    );
    return true;
  } catch (error) {
    warnOnce(error);
    return false;
  }
}

export async function getDocument(id: string): Promise<string | null> {
  const docCollection = await getCollection();
  if (!docCollection) {
    return null;
  }

  try {
    const doc = await executeWithRetry(
      async () =>
        docCollection.findOne(
          { _id: id },
          { projection: { content: 1 } }
        ),
      {
        store: "mongo",
        operation: "findOne",
        isTransient: isTransientMongoError,
        transientFailureCode: "mongo_transient_failure",
      }
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
    const docs = await executeWithRetry(
      async () =>
        docCollection
          .find({ _id: { $in: ids } }, { projection: { content: 1 } })
          .toArray(),
      {
        store: "mongo",
        operation: "findMany",
        isTransient: isTransientMongoError,
        transientFailureCode: "mongo_transient_failure",
      }
    );
    for (const doc of docs) {
      results.set(doc._id, doc.content);
    }
    return results;
  } catch (error) {
    warnOnce(error);
    return results;
  }
}

export async function deleteDocuments(ids: string[]): Promise<boolean> {
  if (ids.length === 0) {
    return true;
  }

  const docCollection = await getCollection();
  if (!docCollection) {
    return false;
  }

  try {
    await executeWithRetry(
      async () => {
        await docCollection.deleteMany({ _id: { $in: ids } });
      },
      {
        store: "mongo",
        operation: "deleteMany",
        isTransient: isTransientMongoError,
        transientFailureCode: "mongo_transient_failure",
      }
    );
    return true;
  } catch (error) {
    warnOnce(error);
    return false;
  }
}
