import { Expectation } from "./expectation";
export class TestGroup {
    public results: Expectation[] = [];

    public description: string;
    public executed: boolean = false;

    constructor(description: string) {
        this.description = description;
    }

    addExpectation(test: Expectation): void {
        this.results.push(test);
    }
}
