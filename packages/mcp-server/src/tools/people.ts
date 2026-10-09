import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { templates, type Person } from "@mia/shared";
import { logEvent, OUTPUT_SHAPE, run, type ToolContext } from "./runtime";

export function findPerson(people: Person[], query: string): Person | undefined {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return people.find((x) => words.includes(x.name.toLowerCase()) || words.includes(x.relationship.toLowerCase().split(" ").at(-1)!));
}

export function registerPeopleTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool("who_is", {
    title: "Who is this person",
    description:
      "Use when she asks who someone is, or about her son, granddaughter, neighbor or husband. Pass her words as 'name'. " +
      "Examples: 'Who is Tom?', 'Where is my son?', 'Wer ist Lily?', 'Wo ist mein Mann?'.",
    inputSchema: { name: z.string().describe("The name or relationship she said, e.g. 'Tom' or 'my son'") },
    outputSchema: OUTPUT_SHAPE,
    annotations: { readOnlyHint: false },
  }, async ({ name }) => run(ctx, async (p) => {
    const T = templates(p.locale);
    const person = findPerson(p.people, name);
    if (!person) {
      await logEvent(ctx, "unknown_question", { topic: "person", query: name.slice(0, 80) });
      return { facts: { found: false }, say: [T.dontKnow(p.carerName)], verbatim: true };
    }
    await logEvent(ctx, "person_asked", { personId: person.id });
    const second = person.contact ?? person.notes;
    return {
      facts: { found: true, name: person.name, relationship: person.relationship },
      say: [T.personIs(person.name, person.relationship), ...(second ? [second] : [])],
      verbatim: true,
    };
  }));
}
