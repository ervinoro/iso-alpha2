import puppeteer from 'puppeteer';
import ts from 'typescript';
import fs from 'fs/promises'

async function main() {
    const browser = await puppeteer.launch({
        args: [
            // Required for Docker version of Puppeteer
            '--no-sandbox',
            '--disable-setuid-sandbox',
            // This will write shared memory files into /tmp instead of /dev/shm,
            // because Docker’s default for /dev/shm is 64MB
            '--disable-dev-shm-usage'
        ]
    });
    const page = await browser.newPage();
    await page.goto('https://www.iso.org/obp/ui/#iso:pub:PUB500001:en');

    const legend = await page.waitForSelector('table[class="grs-grid-legend"]');
    const table = await page.waitForSelector('table[class="grs-grid"]');

    if (!legend || !table) {
        throw new Error("Couldn't find legend and table");
    }

    const statuses = await legend.$$eval('tr',
        trs => (trs as HTMLTableRowElement[])
            .map(tr => tr.querySelectorAll('td'))
            .filter(tds => tds.length === 2)
            .map(tds => [tds[0].className, tds[1].textContent] as [string, string | null])
            .filter((arg): arg is [string, string] => typeof arg[1] === 'string')
    );

    const codes = await table?.$$eval('td',
        tds => (tds as HTMLTableDataCellElement[])
            .map(td => ({
                alpha2: td.textContent,
                name: td.title,
                href: td.querySelector('a')?.href,
                className: td.className
            }))
            .filter((code): code is {
                alpha2: string,
                name: string,
                href: string | undefined,
                className: string,
            } => typeof code.alpha2 === 'string')
    );

    browser.close();

    const code = ts.factory.createSourceFile(
        statuses.flatMap(([statusClassName, name]) => {
            const identifier = name?.replace(/ code elements$/, '').replace(/(?<= )(\w)/, (c) => c.toUpperCase()).replace(/\W/, '');
            return [
                ts.factory.createVariableStatement(
                    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
                    ts.factory.createVariableDeclarationList(
                        [
                            ts.factory.createVariableDeclaration(
                                `iso${identifier}`,
                                undefined,
                                undefined,
                                ts.factory.createAsExpression(
                                    ts.factory.createArrayLiteralExpression(
                                        codes
                                            .filter(({ className }) => className === statusClassName)
                                            .map(({ alpha2 }) => ts.factory.createStringLiteral(alpha2))
                                    ),
                                    ts.factory.createTypeReferenceNode(
                                        ts.factory.createIdentifier('const')
                                    )
                                )
                            )
                        ],
                        ts.NodeFlags.Const
                    )
                ),
                ts.factory.createTypeAliasDeclaration(
                    undefined,
                    [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
                    `Iso${identifier}`,
                    undefined,
                    ts.factory.createIndexedAccessTypeNode(
                        ts.factory.createTypeQueryNode(
                            ts.factory.createIdentifier(
                                `iso${identifier}`
                            )
                        ),
                        ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword)
                    )
                )
            ]
        }),
        ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
        ts.NodeFlags.None
    );

    await fs.mkdir('dist', { recursive: true });
    await fs.writeFile(
        './dist/iso-alpha2.ts',
        ts.createPrinter().printNode(ts.EmitHint.Unspecified, code, code),
        'utf-8'
    );

    const program = ts.createProgram(['./dist/iso-alpha2.ts'], {
        noEmitOnError: true,
        noImplicitAny: true,
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ES2020,
        declaration: true,
        strict: true,
        esModuleInterop: true
    });
    program.emit();
};

main();