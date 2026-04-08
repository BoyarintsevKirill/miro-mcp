#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const MIRO_API = "https://api.miro.com/v2";
const TOKEN = process.env.MIRO_TOKEN;

if (!TOKEN) {
  console.error("MIRO_TOKEN environment variable is required");
  process.exit(1);
}

// --- Miro API helpers ---

async function miroFetch(path, options = {}) {
  const url = path.startsWith("http") ? path : `${MIRO_API}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Miro API ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

function ok(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function boardPath(boardId, suffix = "") {
  return `/boards/${boardId}${suffix}`;
}

// --- Server ---

const server = new McpServer(
  { name: "miro-mcp", version: "1.0.0" },
  { capabilities: {} }
);

// ==================== BOARDS ====================

server.registerTool(
  "create_board",
  {
    description: "Create a new Miro board",
    inputSchema: {
      name: z.string().describe("Board name"),
      description: z.string().optional().describe("Board description"),
    },
  },
  async ({ name, description }) => {
    const body = { name };
    if (description) body.description = description;
    const data = await miroFetch("/boards", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return ok(data);
  }
);

server.registerTool(
  "list_boards",
  {
    description: "List all boards the user has access to",
    inputSchema: {
      query: z.string().optional().describe("Search query to filter boards"),
      limit: z.number().optional().describe("Max results (default 20)"),
    },
  },
  async ({ query, limit }) => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (limit) params.set("limit", String(limit));
    const qs = params.toString();
    const data = await miroFetch(`/boards${qs ? `?${qs}` : ""}`);
    return ok(data);
  }
);

server.registerTool(
  "get_board",
  {
    description: "Get board details by ID",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
    },
  },
  async ({ board_id }) => {
    const data = await miroFetch(boardPath(board_id));
    return ok(data);
  }
);

server.registerTool(
  "get_all_items",
  {
    description:
      "Get all items on a board (sticky notes, shapes, text, frames, etc.)",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      type: z
        .string()
        .optional()
        .describe(
          "Filter by item type: sticky_note, shape, text, frame, card, image, document, connector"
        ),
      limit: z.number().optional().describe("Max results (default 10, max 50)"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
  },
  async ({ board_id, type, limit, cursor }) => {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (limit) params.set("limit", String(limit));
    if (cursor) params.set("cursor", cursor);
    const qs = params.toString();
    const data = await miroFetch(
      boardPath(board_id, `/items${qs ? `?${qs}` : ""}`)
    );
    return ok(data);
  }
);

server.registerTool(
  "get_item",
  {
    description: "Get a specific item by ID and type",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      item_id: z.string().describe("Item ID"),
      type: z.string().describe("Item type: sticky_note, shape, text, frame, card, image, document, connector"),
    },
  },
  async ({ board_id, item_id, type }) => {
    const typeMap = { sticky_note: "sticky_notes", shape: "shapes", text: "texts", frame: "frames", card: "cards", image: "images", document: "documents", connector: "connectors" };
    const path = typeMap[type] || type;
    const data = await miroFetch(boardPath(board_id, `/${path}/${item_id}`));
    return ok(data);
  }
);

// ==================== STICKY NOTES ====================

server.registerTool(
  "create_sticky_note",
  {
    description: "Create a sticky note on a board",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      content: z.string().describe("Text content of the sticky note"),
      color: z
        .string()
        .optional()
        .describe(
          "Color: gray, light_yellow, yellow, orange, light_green, green, dark_green, cyan, light_pink, pink, violet, red, light_blue, blue, dark_blue, black"
        ),
      x: z.number().optional().describe("X position on the board"),
      y: z.number().optional().describe("Y position on the board"),
      width: z.number().optional().describe("Width (default 199)"),
      parent_id: z
        .string()
        .optional()
        .describe("Parent frame ID to place the sticky inside"),
    },
  },
  async ({ board_id, content, color, x, y, width, parent_id }) => {
    const body = {
      data: { content },
      style: {},
      position: {},
    };
    if (color) body.style.fillColor = color;
    if (x !== undefined) body.position.x = x;
    if (y !== undefined) body.position.y = y;
    if (width) body.geometry = { width };
    if (parent_id) body.parent = { id: parent_id };
    const data = await miroFetch(boardPath(board_id, "/sticky_notes"), {
      method: "POST",
      body: JSON.stringify(body),
    });
    return ok(data);
  }
);

server.registerTool(
  "update_sticky_note",
  {
    description: "Update a sticky note (text, color, position)",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      item_id: z.string().describe("Sticky note item ID"),
      content: z.string().optional().describe("New text content"),
      color: z.string().optional().describe("New color"),
      x: z.number().optional().describe("New X position"),
      y: z.number().optional().describe("New Y position"),
    },
  },
  async ({ board_id, item_id, content, color, x, y }) => {
    const body = {};
    if (content !== undefined) body.data = { content };
    if (color) body.style = { fillColor: color };
    if (x !== undefined || y !== undefined) {
      body.position = {};
      if (x !== undefined) body.position.x = x;
      if (y !== undefined) body.position.y = y;
    }
    const data = await miroFetch(
      boardPath(board_id, `/sticky_notes/${item_id}`),
      { method: "PATCH", body: JSON.stringify(body) }
    );
    return ok(data);
  }
);

// ==================== SHAPES ====================

server.registerTool(
  "create_shape",
  {
    description:
      "Create a shape on a board (rectangle, circle, triangle, etc.)",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      content: z.string().optional().describe("Text inside the shape"),
      shape: z
        .string()
        .optional()
        .describe(
          "Shape type: rectangle, round_rectangle, circle, triangle, rhombus, parallelogram, trapezoid, pentagon, hexagon, octagon, wedge_round_rectangle_callout, star, flow_chart_*, cloud, cross, can, right_arrow, left_arrow, left_right_arrow, left_brace, right_brace, heart"
        ),
      color: z.string().optional().describe("Fill color (hex like #FF0000)"),
      border_color: z.string().optional().describe("Border color (hex)"),
      x: z.number().optional().describe("X position"),
      y: z.number().optional().describe("Y position"),
      width: z.number().optional().describe("Width"),
      height: z.number().optional().describe("Height"),
      parent_id: z.string().optional().describe("Parent frame ID"),
    },
  },
  async ({
    board_id,
    content,
    shape,
    color,
    border_color,
    x,
    y,
    width,
    height,
    parent_id,
  }) => {
    const body = { data: {}, style: {}, position: {} };
    if (content) body.data.content = content;
    if (shape) body.data.shape = shape;
    if (color) body.style.fillColor = color;
    if (border_color) body.style.borderColor = border_color;
    if (x !== undefined) body.position.x = x;
    if (y !== undefined) body.position.y = y;
    if (width || height) {
      body.geometry = {};
      if (width) body.geometry.width = width;
      if (height) body.geometry.height = height;
    }
    if (parent_id) body.parent = { id: parent_id };
    const data = await miroFetch(boardPath(board_id, "/shapes"), {
      method: "POST",
      body: JSON.stringify(body),
    });
    return ok(data);
  }
);

server.registerTool(
  "update_shape",
  {
    description: "Update a shape (content, color, position, size)",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      item_id: z.string().describe("Shape item ID"),
      content: z.string().optional().describe("New text content"),
      color: z.string().optional().describe("New fill color"),
      x: z.number().optional().describe("New X position"),
      y: z.number().optional().describe("New Y position"),
      width: z.number().optional().describe("New width"),
      height: z.number().optional().describe("New height"),
    },
  },
  async ({ board_id, item_id, content, color, x, y, width, height }) => {
    const body = {};
    if (content !== undefined) body.data = { content };
    if (color) body.style = { fillColor: color };
    if (x !== undefined || y !== undefined) {
      body.position = {};
      if (x !== undefined) body.position.x = x;
      if (y !== undefined) body.position.y = y;
    }
    if (width || height) {
      body.geometry = {};
      if (width) body.geometry.width = width;
      if (height) body.geometry.height = height;
    }
    const data = await miroFetch(boardPath(board_id, `/shapes/${item_id}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return ok(data);
  }
);

// ==================== TEXT ====================

server.registerTool(
  "create_text",
  {
    description: "Create a text item on a board",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      content: z.string().describe("Text content (supports basic HTML: <b>, <i>, <a>)"),
      x: z.number().optional().describe("X position"),
      y: z.number().optional().describe("Y position"),
      width: z.number().optional().describe("Width"),
      font_size: z.string().optional().describe("Font size: 10, 12, 14, 18, 24, 36, 48, 64, 80, 144, 288"),
      color: z.string().optional().describe("Text color (hex)"),
      parent_id: z.string().optional().describe("Parent frame ID"),
    },
  },
  async ({ board_id, content, x, y, width, font_size, color, parent_id }) => {
    const body = { data: { content }, style: {}, position: {} };
    if (x !== undefined) body.position.x = x;
    if (y !== undefined) body.position.y = y;
    if (width) body.geometry = { width };
    if (font_size) body.style.fontSize = font_size;
    if (color) body.style.color = color;
    if (parent_id) body.parent = { id: parent_id };
    const data = await miroFetch(boardPath(board_id, "/texts"), {
      method: "POST",
      body: JSON.stringify(body),
    });
    return ok(data);
  }
);

server.registerTool(
  "update_text",
  {
    description: "Update a text item",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      item_id: z.string().describe("Text item ID"),
      content: z.string().optional().describe("New text content"),
      x: z.number().optional().describe("New X position"),
      y: z.number().optional().describe("New Y position"),
    },
  },
  async ({ board_id, item_id, content, x, y }) => {
    const body = {};
    if (content !== undefined) body.data = { content };
    if (x !== undefined || y !== undefined) {
      body.position = {};
      if (x !== undefined) body.position.x = x;
      if (y !== undefined) body.position.y = y;
    }
    const data = await miroFetch(boardPath(board_id, `/texts/${item_id}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return ok(data);
  }
);

// ==================== FRAMES ====================

server.registerTool(
  "create_frame",
  {
    description: "Create a frame on a board (container for other items)",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      title: z.string().optional().describe("Frame title"),
      x: z.number().optional().describe("X position"),
      y: z.number().optional().describe("Y position"),
      width: z.number().optional().describe("Width (default 800)"),
      height: z.number().optional().describe("Height (default 600)"),
      color: z.string().optional().describe("Fill color (hex)"),
    },
  },
  async ({ board_id, title, x, y, width, height, color }) => {
    const body = { data: { format: "custom" }, style: {}, position: {} };
    if (title) body.data.title = title;
    if (x !== undefined) body.position.x = x;
    if (y !== undefined) body.position.y = y;
    body.geometry = { width: width || 800, height: height || 600 };
    if (color) body.style.fillColor = color;
    const data = await miroFetch(boardPath(board_id, "/frames"), {
      method: "POST",
      body: JSON.stringify(body),
    });
    return ok(data);
  }
);

server.registerTool(
  "update_frame",
  {
    description: "Update a frame (title, position, size)",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      item_id: z.string().describe("Frame item ID"),
      title: z.string().optional().describe("New title"),
      x: z.number().optional().describe("New X position"),
      y: z.number().optional().describe("New Y position"),
      width: z.number().optional().describe("New width"),
      height: z.number().optional().describe("New height"),
    },
  },
  async ({ board_id, item_id, title, x, y, width, height }) => {
    const body = {};
    if (title !== undefined) body.data = { title };
    if (x !== undefined || y !== undefined) {
      body.position = {};
      if (x !== undefined) body.position.x = x;
      if (y !== undefined) body.position.y = y;
    }
    if (width || height) {
      body.geometry = {};
      if (width) body.geometry.width = width;
      if (height) body.geometry.height = height;
    }
    const data = await miroFetch(boardPath(board_id, `/frames/${item_id}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return ok(data);
  }
);

// ==================== CARDS ====================

server.registerTool(
  "create_card",
  {
    description: "Create a card on a board (like a task card with title and description)",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      title: z.string().describe("Card title"),
      description: z.string().optional().describe("Card description"),
      due_date: z.string().optional().describe("Due date (ISO 8601 format)"),
      x: z.number().optional().describe("X position"),
      y: z.number().optional().describe("Y position"),
      parent_id: z.string().optional().describe("Parent frame ID"),
    },
  },
  async ({ board_id, title, description, due_date, x, y, parent_id }) => {
    const body = { data: { title }, position: {} };
    if (description) body.data.description = description;
    if (due_date) body.data.dueDate = due_date;
    if (x !== undefined) body.position.x = x;
    if (y !== undefined) body.position.y = y;
    if (parent_id) body.parent = { id: parent_id };
    const data = await miroFetch(boardPath(board_id, "/cards"), {
      method: "POST",
      body: JSON.stringify(body),
    });
    return ok(data);
  }
);

// ==================== CONNECTORS ====================

server.registerTool(
  "create_connector",
  {
    description: "Create a connector (arrow/line) between two items",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      start_item_id: z.string().describe("Start item ID"),
      end_item_id: z.string().describe("End item ID"),
      caption: z.string().optional().describe("Text label on the connector"),
      stroke_color: z.string().optional().describe("Line color (hex)"),
      stroke_width: z.string().optional().describe("Line width"),
      style: z
        .string()
        .optional()
        .describe("Line style: normal, dotted, dashed"),
    },
  },
  async ({
    board_id,
    start_item_id,
    end_item_id,
    caption,
    stroke_color,
    stroke_width,
    style: lineStyle,
  }) => {
    const body = {
      startItem: { id: start_item_id },
      endItem: { id: end_item_id },
    };
    if (caption) body.captions = [{ content: caption }];
    if (stroke_color || stroke_width || lineStyle) {
      body.style = {};
      if (stroke_color) body.style.strokeColor = stroke_color;
      if (stroke_width) body.style.strokeWidth = stroke_width;
      if (lineStyle) body.style.strokeStyle = lineStyle;
    }
    const data = await miroFetch(boardPath(board_id, "/connectors"), {
      method: "POST",
      body: JSON.stringify(body),
    });
    return ok(data);
  }
);

// ==================== TAGS ====================

server.registerTool(
  "create_tag",
  {
    description: "Create a tag on a board",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      title: z.string().describe("Tag title"),
      color: z
        .string()
        .optional()
        .describe(
          "Tag color: red, light_green, cyan, yellow, dark_green, blue, violet, dark_blue, orange, gray, black"
        ),
    },
  },
  async ({ board_id, title, color }) => {
    const body = { title };
    if (color) body.fillColor = color;
    const data = await miroFetch(boardPath(board_id, "/tags"), {
      method: "POST",
      body: JSON.stringify(body),
    });
    return ok(data);
  }
);

server.registerTool(
  "attach_tag",
  {
    description: "Attach a tag to an item",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      item_id: z.string().describe("Item ID to tag"),
      tag_id: z.string().describe("Tag ID to attach"),
    },
  },
  async ({ board_id, item_id, tag_id }) => {
    await miroFetch(
      boardPath(board_id, `/items/${item_id}?tag_id=${tag_id}`),
      { method: "POST" }
    );
    return ok({ success: true, item_id, tag_id });
  }
);

// ==================== DELETE ====================

server.registerTool(
  "delete_item",
  {
    description: "Delete any item from a board",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      item_id: z.string().describe("Item ID to delete"),
    },
  },
  async ({ board_id, item_id }) => {
    await miroFetch(boardPath(board_id, `/items/${item_id}`), {
      method: "DELETE",
    });
    return ok({ deleted: item_id });
  }
);

// ==================== IMAGES ====================

server.registerTool(
  "create_image_from_url",
  {
    description: "Add an image to a board from a URL",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      url: z.string().describe("Image URL"),
      title: z.string().optional().describe("Image title"),
      x: z.number().optional().describe("X position"),
      y: z.number().optional().describe("Y position"),
      width: z.number().optional().describe("Width"),
      parent_id: z.string().optional().describe("Parent frame ID"),
    },
  },
  async ({ board_id, url, title, x, y, width, parent_id }) => {
    const body = { data: { url }, position: {} };
    if (title) body.data.title = title;
    if (x !== undefined) body.position.x = x;
    if (y !== undefined) body.position.y = y;
    if (width) body.geometry = { width };
    if (parent_id) body.parent = { id: parent_id };
    const data = await miroFetch(boardPath(board_id, "/images"), {
      method: "POST",
      body: JSON.stringify(body),
    });
    return ok(data);
  }
);

// ==================== MOVE / POSITION ====================

server.registerTool(
  "move_item",
  {
    description: "Move any item to a new position on the board",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      item_id: z.string().describe("Item ID to move"),
      type: z.string().describe("Item type: sticky_note, shape, text, frame, card, image"),
      x: z.number().describe("New X position"),
      y: z.number().describe("New Y position"),
    },
  },
  async ({ board_id, item_id, type, x, y }) => {
    const typeMap = { sticky_note: "sticky_notes", shape: "shapes", text: "texts", frame: "frames", card: "cards", image: "images" };
    const path = typeMap[type] || type;
    const data = await miroFetch(boardPath(board_id, `/${path}/${item_id}`), {
      method: "PATCH",
      body: JSON.stringify({ position: { x, y } }),
    });
    return ok(data);
  }
);

// ==================== BULK ====================

server.registerTool(
  "bulk_create_sticky_notes",
  {
    description:
      "Create multiple sticky notes at once. Pass an array of sticky note definitions.",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      notes: z
        .array(
          z.object({
            content: z.string().describe("Text content"),
            color: z.string().optional().describe("Color"),
            x: z.number().optional().describe("X position"),
            y: z.number().optional().describe("Y position"),
          })
        )
        .describe("Array of sticky notes to create"),
    },
  },
  async ({ board_id, notes }) => {
    const results = [];
    for (const note of notes) {
      try {
        const body = {
          data: { content: note.content },
          style: {},
          position: {},
        };
        if (note.color) body.style.fillColor = note.color;
        if (note.x !== undefined) body.position.x = note.x;
        if (note.y !== undefined) body.position.y = note.y;
        const data = await miroFetch(boardPath(board_id, "/sticky_notes"), {
          method: "POST",
          body: JSON.stringify(body),
        });
        results.push({ success: true, data });
      } catch (err) {
        results.push({ success: false, error: err.message, note });
      }
    }
    return ok(results);
  }
);
// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
