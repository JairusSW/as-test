let lines = 0;
function log(str: string): void {
    lines += 2;
    process.stdout.write(str + "\n");
}
function editLn(line: number, str: string): void {
    process.stdout.write("\033[1A");
    process.stdout.write("\033[2K");
    process.stdout.write("\033[0G");
    process.stdout.write(str + "\n");
}

log("hello");
editLn(0,"bahaha")