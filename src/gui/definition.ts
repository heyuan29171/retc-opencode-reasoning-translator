import { Schema } from "effect"
import { Plugin, Store } from "@opencode/plugin/gui"

export const definition = Plugin.define({
  stores: {
    style: Store.global(
      Schema.Struct({
        bg: Schema.String,
        fg: Schema.String,
        border: Schema.String,
        font: Schema.String,
        size: Schema.Number,
        line: Schema.Number,
      }),
      {
        bg: "#9a9a9a",
        fg: "#141414",
        border: "#666666",
        font: "",
        size: 13.5,
        line: 1.65,
      },
    ),
  },
})
