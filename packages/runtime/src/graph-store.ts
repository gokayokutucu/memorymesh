import neo4j, { Driver } from "neo4j-driver";
import { ISourceMetadata, MemoryType } from "./types";
import {
  executeWithRetry,
  isTransientNeo4jError,
} from "./resilience";

const NEO4J_URI = process.env.NEO4J_URI ?? "bolt://localhost:7687";

let driver: Driver | null = null;
let warned = false;

function warnOnce(error: unknown): void {
  if (!warned) {
    warned = true;
    console.warn("Neo4j graph store unavailable, continuing without graph persistence:", error);
  }
}

async function getDriver(): Promise<Driver | null> {
  if (driver) {
    return driver;
  }

  try {
    driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic("", ""));
    await executeWithRetry(
      async () => driver!.verifyConnectivity(),
      {
        store: "neo4j",
        operation: "verifyConnectivity",
        isTransient: isTransientNeo4jError,
        transientFailureCode: "neo4j_transient_failure",
      }
    );
    return driver;
  } catch (error) {
    warnOnce(error);
    return null;
  }
}

export async function saveNode(
  id: string,
  memory_type: MemoryType,
  project: string,
  createdAt: string,
  tags: string[],
  title?: string,
  refId?: string,
  importance?: number,
  conversationId?: string,
  parentMemoryId?: string,
  derivedFromMemoryId?: string,
  sourceAgent?: string,
  sourceFormat?: string,
  messageIndex?: number,
  sourceMetadata?: ISourceMetadata
): Promise<boolean> {
  const activeDriver = await getDriver();
  if (!activeDriver) {
    return false;
  }

  const session = activeDriver.session();
  try {
    await executeWithRetry(
      async () =>
        session.run(
          `
      MERGE (m:Memory {id: $id})
      SET m.memory_type = $memory_type,
          m.project = $project,
          m.created_at = datetime($created_at),
          m.title = $title,
          m.ref_id = $ref_id,
          m.importance = $importance,
          m.conversation_id = $conversation_id,
          m.source_agent = $source_agent,
          m.source_format = $source_format,
          m.message_index = $message_index,
          m.source_filename = $source_filename,
          m.source_path = $source_path,
          m.relative_path = $relative_path,
          m.source_extension = $source_extension,
          m.source_chunk_index = $source_chunk_index,
          m.source_chunk_total = $source_chunk_total,
          m.parent_memory_id = $parent_memory_id,
          m.derived_from_memory_id = $derived_from_memory_id
      MERGE (p:Project {name: $project})
      MERGE (m)-[bp:BELONGS_TO]->(p)
      SET bp.kind = 'inferred'
      `,
          {
            id,
            memory_type,
            project,
            created_at: createdAt,
            title: title ?? null,
            ref_id: refId ?? null,
            importance: importance ?? null,
            conversation_id: conversationId ?? null,
            source_agent: sourceAgent ?? null,
            source_format: sourceFormat ?? null,
            message_index: messageIndex ?? null,
            source_filename: sourceMetadata?.filename ?? null,
            source_path: sourceMetadata?.source_path ?? null,
            relative_path: sourceMetadata?.relative_path ?? null,
            source_extension: sourceMetadata?.source_extension ?? null,
            source_chunk_index: sourceMetadata?.chunk_index ?? null,
            source_chunk_total: sourceMetadata?.chunk_total ?? null,
            parent_memory_id: parentMemoryId ?? null,
            derived_from_memory_id: derivedFromMemoryId ?? null,
          }
        ),
      {
        store: "neo4j",
        operation: "saveNodeMemory",
        isTransient: isTransientNeo4jError,
        transientFailureCode: "neo4j_transient_failure",
      }
    );

    if (parentMemoryId) {
      await executeWithRetry(
        async () =>
          session.run(
            `
        MERGE (parent:Memory {id: $parentId})
        MATCH (m:Memory {id: $id})
        MERGE (m)-[r:CHILD_OF]->(parent)
        SET r.kind = 'explicit'
        `,
            { id, parentId: parentMemoryId }
          ),
        {
          store: "neo4j",
          operation: "saveNodeParentRelation",
          isTransient: isTransientNeo4jError,
          transientFailureCode: "neo4j_transient_failure",
        }
      );
    }

    if (derivedFromMemoryId) {
      await executeWithRetry(
        async () =>
          session.run(
            `
        MERGE (source:Memory {id: $sourceId})
        MATCH (m:Memory {id: $id})
        MERGE (m)-[r:DERIVED_FROM]->(source)
        SET r.kind = 'explicit'
        `,
            { id, sourceId: derivedFromMemoryId }
          ),
        {
          store: "neo4j",
          operation: "saveNodeDerivedRelation",
          isTransient: isTransientNeo4jError,
          transientFailureCode: "neo4j_transient_failure",
        }
      );
    }

    for (const tag of tags) {
      await executeWithRetry(
        async () =>
          session.run(
            `
        MATCH (m:Memory {id: $id})
        MERGE (t:Tag {name: $tag})
        MERGE (m)-[ht:HAS_TAG]->(t)
        SET ht.kind = 'inferred'
        `,
            { id, tag }
          ),
        {
          store: "neo4j",
          operation: "saveNodeTagRelation",
          isTransient: isTransientNeo4jError,
          transientFailureCode: "neo4j_transient_failure",
        }
      );
    }
    return true;
  } catch (error) {
    warnOnce(error);
    return false;
  } finally {
    await session.close();
  }
}

export async function linkNodes(
  fromId: string,
  toId: string,
  relation: string
): Promise<void> {
  const activeDriver = await getDriver();
  if (!activeDriver) {
    return;
  }

  const safeRelation = relation.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase() || "RELATED";
  const session = activeDriver.session();
  try {
    await executeWithRetry(
      async () =>
        session.run(
          `
      MATCH (a:Memory {id: $fromId})
      MATCH (b:Memory {id: $toId})
      MERGE (a)-[r:RELATED {relation_type: $relationType}]->(b)
      SET r.kind = 'explicit'
      `,
          { fromId, toId, relationType: safeRelation }
        ),
      {
        store: "neo4j",
        operation: "linkNodes",
        isTransient: isTransientNeo4jError,
        transientFailureCode: "neo4j_transient_failure",
      }
    );
  } catch (error) {
    warnOnce(error);
  } finally {
    await session.close();
  }
}

export async function getRelated(id: string): Promise<string[]> {
  const activeDriver = await getDriver();
  if (!activeDriver) {
    return [];
  }

  const session = activeDriver.session();
  try {
    const result = await executeWithRetry(
      async () =>
        session.run(
          `
      MATCH (m:Memory {id: $id})
      CALL {
        WITH m
        MATCH (m)-[:HAS_TAG]->(:Tag)<-[:HAS_TAG]-(related:Memory)
        WHERE related.id <> m.id
        RETURN related
        UNION
        WITH m
        MATCH (m)-[:BELONGS_TO]->(:Project)<-[:BELONGS_TO]-(related:Memory)
        WHERE related.id <> m.id
        RETURN related
        UNION
        WITH m
        MATCH (m)-[r:RELATED {kind: 'explicit'}]-(related:Memory)
        WHERE related.id <> m.id
        RETURN related
      }
      RETURN DISTINCT related.id AS id
      LIMIT 50
      `,
          { id }
        ),
      {
        store: "neo4j",
        operation: "getRelated",
        isTransient: isTransientNeo4jError,
        transientFailureCode: "neo4j_transient_failure",
      }
    );

    return result.records
      .map((record) => record.get("id"))
      .filter((value): value is string => typeof value === "string");
  } catch (error) {
    warnOnce(error);
    return [];
  } finally {
    await session.close();
  }
}

export async function deleteNodes(ids: string[]): Promise<boolean> {
  if (ids.length === 0) {
    return true;
  }

  const activeDriver = await getDriver();
  if (!activeDriver) {
    return false;
  }

  const session = activeDriver.session();
  try {
    await executeWithRetry(
      async () =>
        session.run(
          `
      MATCH (m:Memory)
      WHERE m.id IN $ids
      DETACH DELETE m
      `,
          { ids }
        ),
      {
        store: "neo4j",
        operation: "deleteNodes",
        isTransient: isTransientNeo4jError,
        transientFailureCode: "neo4j_transient_failure",
      }
    );
    return true;
  } catch (error) {
    warnOnce(error);
    return false;
  } finally {
    await session.close();
  }
}

export async function queryByTags(
  tags: string[],
  limit = 20
): Promise<string[]> {
  if (tags.length === 0) {
    return [];
  }

  const activeDriver = await getDriver();
  if (!activeDriver) {
    return [];
  }

  const session = activeDriver.session();
  try {
    const result = await executeWithRetry(
      async () =>
        session.run(
          `
      MATCH (m:Memory)-[:HAS_TAG]->(t:Tag)
      WHERE t.name IN $tags
      RETURN DISTINCT m.id AS id, m.created_at AS created_at
      ORDER BY m.created_at DESC
      LIMIT $limit
      `,
          { tags, limit: neo4j.int(limit) }
        ),
      {
        store: "neo4j",
        operation: "queryByTags",
        isTransient: isTransientNeo4jError,
        transientFailureCode: "neo4j_transient_failure",
      }
    );

    return result.records
      .map((record) => record.get("id"))
      .filter((value): value is string => typeof value === "string");
  } catch (error) {
    warnOnce(error);
    return [];
  } finally {
    await session.close();
  }
}

export async function queryByDateRange(
  after?: string,
  before?: string,
  project?: string,
  limit = 20
): Promise<string[]> {
  const activeDriver = await getDriver();
  if (!activeDriver) {
    return [];
  }

  const session = activeDriver.session();
  try {
    const result = await executeWithRetry(
      async () =>
        session.run(
          `
      MATCH (m:Memory)
      WHERE ($after IS NULL OR m.created_at >= datetime($after))
        AND ($before IS NULL OR m.created_at <= datetime($before))
        AND ($project IS NULL OR m.project = $project)
      RETURN m.id AS id
      ORDER BY m.created_at DESC
      LIMIT $limit
      `,
          {
            after: after ?? null,
            before: before ?? null,
            project: project ?? null,
            limit: neo4j.int(limit),
          }
        ),
      {
        store: "neo4j",
        operation: "queryByDateRange",
        isTransient: isTransientNeo4jError,
        transientFailureCode: "neo4j_transient_failure",
      }
    );

    return result.records
      .map((record) => record.get("id"))
      .filter((value): value is string => typeof value === "string");
  } catch (error) {
    warnOnce(error);
    return [];
  } finally {
    await session.close();
  }
}

export async function queryRelated(
  ids: string[],
  limit = 20
): Promise<string[]> {
  if (ids.length === 0) {
    return [];
  }

  const activeDriver = await getDriver();
  if (!activeDriver) {
    return [];
  }

  const session = activeDriver.session();
  try {
    const result = await executeWithRetry(
      async () =>
        session.run(
          `
      MATCH (m:Memory)
      WHERE m.id IN $ids
      CALL {
        WITH m
        MATCH (m)-[:HAS_TAG]->(:Tag)<-[:HAS_TAG]-(related:Memory)
        WHERE NOT related.id IN $ids
        RETURN related
        UNION
        WITH m
        MATCH (m)-[:BELONGS_TO]->(:Project)<-[:BELONGS_TO]-(related:Memory)
        WHERE NOT related.id IN $ids
        RETURN related
        UNION
        WITH m
        MATCH (m)-[r:RELATED {kind: 'explicit'}]-(related:Memory)
        WHERE NOT related.id IN $ids
        RETURN related
      }
      RETURN DISTINCT related.id AS id
      LIMIT $limit
      `,
          { ids, limit: neo4j.int(limit) }
        ),
      {
        store: "neo4j",
        operation: "queryRelated",
        isTransient: isTransientNeo4jError,
        transientFailureCode: "neo4j_transient_failure",
      }
    );

    return result.records
      .map((record) => record.get("id"))
      .filter((value): value is string => typeof value === "string");
  } catch (error) {
    warnOnce(error);
    return [];
  } finally {
    await session.close();
  }
}
