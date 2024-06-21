import yargs, { Arguments } from 'yargs';
import { hideBin } from 'yargs/helpers'

const cli = yargs(hideBin(process.argv));

cli.command('build <options>', 'options', () => {}, (argv) => {
    console.info(argv)
  })
  .demandCommand(1)
  .parse()