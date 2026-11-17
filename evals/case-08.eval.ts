import { defineEval } from "eve/evals";
import { rows } from "./fixtures/rows.js";

// Never runs here: the repro only lists evals. The import of a large fixture
// makes each bundled cache file several MB, so writing it takes long enough to race.
export default defineEval({
  description: "case 08",
  async test(t) {
    t.score(rows.length > 0 ? 1 : 0).label("case-08");
  },
});
