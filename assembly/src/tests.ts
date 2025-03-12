import { JSON } from "json-as";


@json
export class Tests {
  public order: i32 = 0;
  public type: string = "";
  public verdict: string = "none";
  public left: JSON.Raw = JSON.Raw.from("");
  public right: JSON.Raw = JSON.Raw.from("");
  public instr: string = "";
}
