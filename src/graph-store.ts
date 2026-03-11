import neo4j, { Driver } from "neo4j-driver";
import { MemoryType } from "./types";

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
    await driver.verifyConnectivity();
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
  tags: string[],
  title?: string,
  refId?: string
): Promise<void> {
  const activeDriver = await getDriver();
  if (!activeDriver) {
    return;
  }

  const session = activeDriver.session();
  try {
    await session.run(
      `
      MERGE (m:Memory {id: $id})
      SET m.memory_type = $memory_type,
          m.project = $project,
          m.created_at = datetime($created_at),
          m.title = $title,
          m.ref_id = $ref_id
      WITH m
      MATCH (other:Memory {project: $project})
      WHERE other.id <> $id
      MERGE (m)-[:SAME_PROJECT]->(other)
      `,
      {
        id,
        memory_type,
        project,
        created_at: new Date().toISOString(),
        title: title ?? null,
        ref_id: refId ?? null,
      }
    );

    for (const tag of tags) {
      await session.run(
        `
        MATCH (m:Memory {id: $id})
        MERGE (t:Tag {name: $tag})
        MERGE (m)-[:HAS_TAG]->(t)
        `,
        { id, tag }
      );
    }
  } catch (error) {
    warnOnce(error);
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
    await session.run(
      `
      MATCH (a:Memory {id: $fromId})
      MATCH (b:Memory {id: $toId})
      MERGE (a)-[r:${safeRelation}]->(b)
      `,
      { fromId, toId }
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
    const result = await session.run(
      `
      MATCH (m:Memory {id: $id})-[:SAME_PROJECT|HAS_TAG*1..2]-(related:Memory)
      RETURN DISTINCT related.id AS id
      LIMIT 50
      `,
      { id }
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
    const result = await session.run(
      `
      MATCH (m:Memory)-[:HAS_TAG]->(t:Tag)
      WHERE t.name IN $tags
      RETURN DISTINCT m.id AS id, m.created_at AS created_at
      ORDER BY m.created_at DESC
      LIMIT $limit
      `,
      { tags, limit: neo4j.int(limit) }
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
    const result = await session.run(
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
    const result = await session.run(
      `
      MATCH (m:Memory)-[:SAME_PROJECT|HAS_TAG*1..2]-(related:Memory)
      WHERE m.id IN $ids AND NOT related.id IN $ids
      RETURN DISTINCT related.id AS id
      LIMIT $limit
      `,
      { ids, limit: neo4j.int(limit) }
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
