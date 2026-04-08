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

// Snap coordinate to grid (step = 50)
function snap(value) {
  return Math.round(value / 50) * 50;
}

// Calculate RELATIVE position for an element inside a frame
// When using parent:{id:frameId}, coordinates are relative to frame's top-left corner
// frame: {width, height} (frame dimensions)
// col, row: grid position (0-based)
// cols: total columns
// itemWidth, itemHeight: size of item
// padding: distance from frame edges
function frameCell(frame, col, row, cols, itemWidth = 200, itemHeight = 200, padding = 60) {
  const titleOffset = 60; // space for frame title bar
  const innerW = frame.width - padding * 2;
  const cellW = innerW / cols;
  return {
    x: snap(padding + cellW * col + cellW / 2),
    y: snap(titleOffset + padding + (itemHeight + 30) * row + itemHeight / 2),
  };
}

// --- Design System ---

const THEMES = {
  vibrant: {
    name: "Vibrant",
    description: "Bright, saturated colors with high contrast. Great for brainstorming and workshops.",
    sticky: {
      primary: "yellow",
      secondary: "cyan",
      accent: "orange",
      positive: "green",
      negative: "red",
      neutral: "violet",
    },
    shape: {
      fill: "#FFD700",
      border: "#333333",
      headerFill: "#4A90D9",
      headerText: "#FFFFFF",
    },
    frame: { fill: "#F7F7F7" },
    connector: { color: "#333333", width: "2" },
    text: { heading: "#1A1A1A", body: "#333333" },
  },
  calm: {
    name: "Calm",
    description: "Soft pastel tones, easy on the eyes. Good for strategy and analysis.",
    sticky: {
      primary: "light_yellow",
      secondary: "light_blue",
      accent: "yellow",
      positive: "light_green",
      negative: "light_pink",
      neutral: "gray",
    },
    shape: {
      fill: "#E8F4FD",
      border: "#90B8D0",
      headerFill: "#5B9BD5",
      headerText: "#FFFFFF",
    },
    frame: { fill: "#FAFAFA" },
    connector: { color: "#90B8D0", width: "2" },
    text: { heading: "#2C3E50", body: "#555555" },
  },
  mono: {
    name: "Mono",
    description: "Grayscale with one accent color. Clean, professional, minimal.",
    sticky: {
      primary: "gray",
      secondary: "gray",
      accent: "light_blue",
      positive: "light_green",
      negative: "light_pink",
      neutral: "gray",
    },
    shape: {
      fill: "#F0F0F0",
      border: "#AAAAAA",
      headerFill: "#555555",
      headerText: "#FFFFFF",
    },
    frame: { fill: "#FAFAFA" },
    connector: { color: "#888888", width: "1.5" },
    text: { heading: "#222222", body: "#666666" },
  },
};

const GRID_STEP = 50;
const SPACING = 30;
const FRAME_GAP = 150;

let currentTheme = "calm"; // default

// Board style: controls which element types to use for consistency
// "stickers" = sticky notes for content, shapes for headers only
// "shapes" = shapes for everything, no sticky notes
// "cards" = cards for tasks/items, shapes for structure
const BOARD_STYLES = {
  stickers: {
    name: "Stickers",
    description: "Sticky notes for all content. Colorful, informal, workshop-style.",
    content: "sticky_note",
    header: "shape",
    label: "text",
  },
  shapes: {
    name: "Shapes",
    description: "Shapes for everything. Clean, structured, professional.",
    content: "shape",
    header: "shape",
    label: "text",
  },
  cards: {
    name: "Cards",
    description: "Cards for actionable items. Structured with titles and descriptions.",
    content: "card",
    header: "shape",
    label: "text",
  },
};

let currentBoardStyle = "stickers"; // default

function theme() {
  return THEMES[currentTheme];
}

function boardStyle() {
  return BOARD_STYLES[currentBoardStyle];
}

function stickyColor(semantic) {
  return theme().sticky[semantic] || theme().sticky.primary;
}

// --- Server ---

const server = new McpServer(
  { name: "miro-mcp", version: "1.0.0" },
  { capabilities: {} }
);

// ==================== THEME ====================

server.registerTool(
  "set_theme",
  {
    description:
      "Set the visual theme for the board. All subsequent create operations will use this theme's colors and styles. Call this FIRST before creating any elements. Available themes:\n- vibrant: bright saturated colors, high contrast (brainstorming, workshops)\n- calm: soft pastels, easy on the eyes (strategy, analysis)\n- mono: grayscale + one accent color, clean and professional",
    inputSchema: {
      theme: z
        .enum(["vibrant", "calm", "mono"])
        .describe("Theme name: vibrant, calm, or mono"),
    },
  },
  async ({ theme: themeName }) => {
    currentTheme = themeName;
    const t = theme();
    return ok({
      selected: themeName,
      name: t.name,
      description: t.description,
      palette: t.sticky,
      hint: "All create operations will now use this theme. Use 'semantic' parameter (primary, secondary, accent, positive, negative, neutral) on sticky notes to auto-pick colors.",
    });
  }
);

server.registerTool(
  "get_theme",
  {
    description: "Get the current active theme and its full color palette",
    inputSchema: {},
  },
  async () => {
    const t = theme();
    return ok({
      current: currentTheme,
      name: t.name,
      description: t.description,
      stickyColors: t.sticky,
      shapeColors: t.shape,
      frameColors: t.frame,
      connectorStyle: t.connector,
      textColors: t.text,
      grid: { step: GRID_STEP, spacing: SPACING, frameGap: FRAME_GAP },
    });
  }
);

server.registerTool(
  "set_board_style",
  {
    description:
      "Set which element types to use for consistency across the board. Call this FIRST along with set_theme.\n- stickers: sticky notes for content, colorful and informal (workshops, brainstorming)\n- shapes: shapes for everything, clean and structured (presentations, docs)\n- cards: cards for actionable items with titles and descriptions (task boards, backlogs)\nAll subsequent layout and create operations will respect this style.",
    inputSchema: {
      style: z
        .enum(["stickers", "shapes", "cards"])
        .describe("Board style: stickers, shapes, or cards"),
    },
  },
  async ({ style }) => {
    currentBoardStyle = style;
    const s = boardStyle();
    return ok({
      selected: style,
      name: s.name,
      description: s.description,
      elements: s,
      hint: "Content will now be created as " + s.content + ". Use layout_in_frame to auto-position elements.",
    });
  }
);

server.registerTool(
  "create_content_item",
  {
    description:
      "Create a content item using the current board style. One item = one thought (1-3 lines). Automatically creates the right element type (sticky note, shape, or card) based on set_board_style. Use this for consistent boards.",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      content: z.string().describe("Text content (or title for cards)"),
      description: z.string().optional().describe("Description (only used for cards style)"),
      semantic: z
        .enum(["primary", "secondary", "accent", "positive", "negative", "neutral"])
        .optional()
        .describe("Semantic color from theme"),
      x: z.number().optional().describe("X position"),
      y: z.number().optional().describe("Y position"),
      width: z.number().optional().describe("Width"),
      height: z.number().optional().describe("Height (shapes only)"),
      parent_id: z.string().optional().describe("Parent frame ID"),
    },
  },
  async ({ board_id, content, description, semantic, x, y, width, height, parent_id }) => {
    const style = boardStyle();
    const t = theme();
    let data;

    if (style.content === "sticky_note") {
      const body = {
        data: { content },
        style: { fillColor: stickyColor(semantic || "primary") },
        position: {},
      };
      if (x !== undefined) body.position.x = snap(x);
      if (y !== undefined) body.position.y = snap(y);
      if (width) body.geometry = { width };
      if (parent_id) body.parent = { id: parent_id };
      data = await miroFetch(boardPath(board_id, "/sticky_notes"), {
        method: "POST",
        body: JSON.stringify(body),
      });
    } else if (style.content === "shape") {
      const fillColor = semantic === "negative" ? "#FDE8E8"
        : semantic === "positive" ? "#E8F5E9"
        : semantic === "accent" ? "#FFF3E0"
        : semantic === "secondary" ? "#E8F4FD"
        : t.shape.fill;
      const borderColor = semantic === "negative" ? "#E74C3C"
        : semantic === "positive" ? "#4CAF50"
        : semantic === "accent" ? "#FF9800"
        : semantic === "secondary" ? "#2196F3"
        : t.shape.border;
      const body = {
        data: { content, shape: "round_rectangle" },
        style: { fillColor, borderColor },
        position: {},
      };
      if (x !== undefined) body.position.x = snap(x);
      if (y !== undefined) body.position.y = snap(y);
      if (width || height) {
        body.geometry = {};
        if (width) body.geometry.width = width;
        if (height) body.geometry.height = height;
      }
      if (parent_id) body.parent = { id: parent_id };
      data = await miroFetch(boardPath(board_id, "/shapes"), {
        method: "POST",
        body: JSON.stringify(body),
      });
    } else if (style.content === "card") {
      const body = {
        data: { title: content },
        position: {},
      };
      if (description) body.data.description = description;
      if (x !== undefined) body.position.x = snap(x);
      if (y !== undefined) body.position.y = snap(y);
      if (parent_id) body.parent = { id: parent_id };
      data = await miroFetch(boardPath(board_id, "/cards"), {
        method: "POST",
        body: JSON.stringify(body),
      });
    }
    return ok(data);
  }
);

// ==================== LAYOUT ====================

server.registerTool(
  "layout_in_frame",
  {
    description:
      "Create multiple content items inside a frame in a grid layout. Each item should contain ONE thought (1-3 lines max). Split long lists into separate items. Respects board style and theme. Auto-sizes items to fit frame. Nothing overlaps or escapes.",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      frame_id: z.string().describe("Frame ID to place items inside"),
      columns: z.number().optional().describe("Number of columns (default: auto)"),
      item_width: z.number().optional().describe("Width of each item in pixels (default: auto-calculated to fit frame)"),
      items: z
        .array(
          z.object({
            content: z.string().describe("Text content (or title for cards)"),
            description: z.string().optional().describe("Description (cards only)"),
            semantic: z
              .enum(["primary", "secondary", "accent", "positive", "negative", "neutral"])
              .optional()
              .describe("Semantic color from theme"),
          })
        )
        .describe("Array of items to create"),
    },
  },
  async ({ board_id, frame_id, columns, item_width, items }) => {
    const frame = await miroFetch(boardPath(board_id, `/frames/${frame_id}`));
    const fw = frame.geometry.width;
    const fh = frame.geometry.height;
    const cols = columns || Math.min(items.length, Math.max(2, Math.ceil(Math.sqrt(items.length))));
    const padding = 60;
    const autoWidth = item_width || Math.min(250, Math.floor((fw - padding * 2) / cols - 30));
    const style = boardStyle();
    const t = theme();

    const results = [];
    for (let i = 0; i < items.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const pos = frameCell({ width: fw, height: fh }, col, row, cols);
      const sem = items[i].semantic || "primary";

      try {
        let data;
        if (style.content === "sticky_note") {
          data = await miroFetch(boardPath(board_id, "/sticky_notes"), {
            method: "POST",
            body: JSON.stringify({
              data: { content: items[i].content },
              style: { fillColor: stickyColor(sem) },
              position: { x: pos.x, y: pos.y },
              geometry: { width: autoWidth },
              parent: { id: frame_id },
            }),
          });
        } else if (style.content === "shape") {
          const fillColor = sem === "negative" ? "#FDE8E8" : sem === "positive" ? "#E8F5E9" : sem === "accent" ? "#FFF3E0" : sem === "secondary" ? "#E8F4FD" : t.shape.fill;
          const borderColor = sem === "negative" ? "#E74C3C" : sem === "positive" ? "#4CAF50" : sem === "accent" ? "#FF9800" : sem === "secondary" ? "#2196F3" : t.shape.border;
          data = await miroFetch(boardPath(board_id, "/shapes"), {
            method: "POST",
            body: JSON.stringify({
              data: { content: items[i].content, shape: "round_rectangle" },
              style: { fillColor, borderColor },
              position: { x: pos.x, y: pos.y },
              geometry: { width: 200, height: 150 },
              parent: { id: frame_id },
            }),
          });
        } else if (style.content === "card") {
          data = await miroFetch(boardPath(board_id, "/cards"), {
            method: "POST",
            body: JSON.stringify({
              data: { title: items[i].content, description: items[i].description || "" },
              position: { x: pos.x, y: pos.y },
              parent: { id: frame_id },
            }),
          });
        }
        results.push({ success: true, id: data?.id });
      } catch (err) {
        results.push({ success: false, error: err.message });
      }
    }
    return ok({ frame: { id: frame_id, width: fw, height: fh }, style: style.content, columns: cols, created: results.filter(r => r.success).length, results });
  }
);

server.registerTool(
  "get_frame_bounds",
  {
    description:
      "Get a frame's position and dimensions. Use this to calculate where to place elements inside the frame without overlap. Returns x, y (center), width, height, and the top-left corner coordinates.",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      frame_id: z.string().describe("Frame ID"),
    },
  },
  async ({ board_id, frame_id }) => {
    const frame = await miroFetch(boardPath(board_id, `/frames/${frame_id}`));
    const fx = frame.position.x;
    const fy = frame.position.y;
    const fw = frame.geometry.width;
    const fh = frame.geometry.height;
    return ok({
      id: frame_id,
      center: { x: fx, y: fy },
      size: { width: fw, height: fh },
      relativeCoords: {
        description: "When using parent:{id:frameId}, positions are RELATIVE to frame top-left. Use these bounds.",
        safeTopLeft: { x: 60, y: 120 },
        safeBottomRight: { x: snap(fw - 60), y: snap(fh - 60) },
        safeWidth: fw - 120,
        safeHeight: fh - 180,
      },
      absoluteCoords: {
        description: "When NOT using parent, use absolute canvas coordinates.",
        topLeft: { x: fx - fw / 2, y: fy - fh / 2 },
        bottomRight: { x: fx + fw / 2, y: fy + fh / 2 },
      },
    });
  }
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
    description:
      "Create a sticky note on a board. IMPORTANT: one sticky = one thought. Keep text to 1-3 lines max. If you have multiple points, create multiple stickies. Uses the current theme for colors. Coordinates are auto-snapped to a 50px grid.",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      content: z.string().describe("Text content of the sticky note"),
      color: z
        .string()
        .optional()
        .describe(
          "Explicit color (overrides theme). Values: gray, light_yellow, yellow, orange, light_green, green, dark_green, cyan, light_pink, pink, violet, red, light_blue, blue, dark_blue, black"
        ),
      semantic: z
        .enum(["primary", "secondary", "accent", "positive", "negative", "neutral"])
        .optional()
        .describe(
          "Semantic color from current theme. primary=main info, secondary=supporting, accent=important, positive=good/solutions, negative=problems/risks, neutral=meta. Ignored if 'color' is set."
        ),
      x: z.number().optional().describe("X position (auto-snapped to 50px grid)"),
      y: z.number().optional().describe("Y position (auto-snapped to 50px grid)"),
      width: z.number().optional().describe("Width (default 200)"),
      parent_id: z
        .string()
        .optional()
        .describe("Parent frame ID to place the sticky inside"),
    },
  },
  async ({ board_id, content, color, semantic, x, y, width, parent_id }) => {
    const fillColor = color || stickyColor(semantic || "primary");
    const body = {
      data: { content },
      style: { fillColor },
      position: {},
    };
    if (x !== undefined) body.position.x = snap(x);
    if (y !== undefined) body.position.y = snap(y);
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
    const t = theme();
    const body = { data: {}, style: {}, position: {} };
    if (content) body.data.content = content;
    if (shape) body.data.shape = shape;
    body.style.fillColor = color || t.shape.fill;
    body.style.borderColor = border_color || t.shape.border;
    if (x !== undefined) body.position.x = snap(x);
    if (y !== undefined) body.position.y = snap(y);
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
    const t = theme();
    const body = { data: { content }, style: {}, position: {} };
    if (x !== undefined) body.position.x = snap(x);
    if (y !== undefined) body.position.y = snap(y);
    if (width) body.geometry = { width };
    body.style.fontSize = font_size || "14";
    body.style.color = color || t.text.body;
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
    const t = theme();
    const body = { data: { format: "custom" }, style: {}, position: {} };
    if (title) body.data.title = title;
    if (x !== undefined) body.position.x = snap(x);
    if (y !== undefined) body.position.y = snap(y);
    body.geometry = { width: width || 800, height: height || 600 };
    body.style.fillColor = color || t.frame.fill;
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
    if (x !== undefined) body.position.x = snap(x);
    if (y !== undefined) body.position.y = snap(y);
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
    const t = theme();
    if (caption) body.captions = [{ content: caption }];
    body.style = {
      strokeColor: stroke_color || t.connector.color,
      strokeWidth: stroke_width || t.connector.width,
      strokeStyle: lineStyle || "normal",
    };
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
    if (x !== undefined) body.position.x = snap(x);
    if (y !== undefined) body.position.y = snap(y);
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
      body: JSON.stringify({ position: { x: snap(x), y: snap(y) } }),
    });
    return ok(data);
  }
);

// ==================== BULK ====================

server.registerTool(
  "bulk_create_sticky_notes",
  {
    description:
      "Create multiple sticky notes at once. Uses current theme. Coordinates auto-snapped to 50px grid.",
    inputSchema: {
      board_id: z.string().describe("Board ID"),
      notes: z
        .array(
          z.object({
            content: z.string().describe("Text content"),
            color: z.string().optional().describe("Explicit color (overrides theme)"),
            semantic: z
              .enum(["primary", "secondary", "accent", "positive", "negative", "neutral"])
              .optional()
              .describe("Semantic color from theme"),
            x: z.number().optional().describe("X position (auto-snapped)"),
            y: z.number().optional().describe("Y position (auto-snapped)"),
          })
        )
        .describe("Array of sticky notes to create"),
    },
  },
  async ({ board_id, notes }) => {
    const results = [];
    for (const note of notes) {
      try {
        const fillColor = note.color || stickyColor(note.semantic || "primary");
        const body = {
          data: { content: note.content },
          style: { fillColor },
          position: {},
        };
        if (note.x !== undefined) body.position.x = snap(note.x);
        if (note.y !== undefined) body.position.y = snap(note.y);
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
