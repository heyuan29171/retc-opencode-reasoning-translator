import { Rpc } from "@opencode/plugin/rpc"

export const Retc = Rpc.define({
  id: "retc",
  methods: {
    snapshot: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          text: { type: "string" },
          status: { type: "string" },
          model: { type: "string" },
        },
        required: ["text", "status", "model"],
        additionalProperties: false,
      },
    },
    models: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          models: {
            type: "array",
            items: {
              type: "object",
              properties: {
                providerID: { type: "string" },
                id: { type: "string" },
                name: { type: "string" },
              },
              required: ["providerID", "id", "name"],
              additionalProperties: false,
            },
          },
        },
        required: ["models"],
        additionalProperties: false,
      },
    },
    getSettings: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { model: { type: "string" } },
        required: ["model"],
        additionalProperties: false,
      },
    },
    setSettings: {
      input: {
        type: "object",
        properties: { model: { type: "string" } },
        required: ["model"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    },
  },
  events: {
    reasoning: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          partID: { type: "string" },
          text: { type: "string" },
          status: { type: "string" },
          model: { type: "string" },
        },
        required: ["sessionID", "partID", "text", "status", "model"],
        additionalProperties: false,
      },
    },
  },
})
