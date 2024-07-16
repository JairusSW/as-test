import { __HASHES, __POINTS } from "../../assembly/coverage";
import { Result } from "..";
export function addToResults(): Result {
  const result = new Result("Coverage", __HASHES().size, __POINTS());
  return result;
}
