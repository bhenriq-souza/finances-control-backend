import type { DataSource } from 'typeorm';

import { container } from '../container';
import {
    BankAccountService,
    BankAccountServiceSymbol,
    BankService,
    BankServiceSymbol,
    CreditCardService,
    CreditCardServiceSymbol,
} from '../accounts';
import {
    EarningService,
    EarningServiceSymbol,
    EarningTypeService,
    EarningTypeServiceSymbol,
} from '../earnings';
import {
    ExpenseService,
    ExpenseServiceSymbol,
    ExpenseTypeService,
    ExpenseTypeServiceSymbol,
} from '../expenses';
import {
    AppDataSource,
    DatabaseConnectionSymbol,
    EnvListSymbol,
    RequestContextSymbol,
    envList,
    initializeDataSource,
    type RequestContext,
} from '../platform';

/** The services the initial load writes through (INV-0019-02), resolved by their symbols. */
export type LoadServices = {
    banks: BankService;
    accounts: BankAccountService;
    cards: CreditCardService;
    expenseTypes: ExpenseTypeService;
    expenses: ExpenseService;
    earningTypes: EarningTypeService;
    earnings: EarningService;
    /**
     * Runs the writes with the load's workspace in the context, as a request would have it
     * (spec 0021): the services store the workspace they read from there. A dry run never
     * creates the workspace: it writes nothing.
     */
    inWorkspace: <T>(work: () => Promise<T>, options: { dryRun: boolean }) => Promise<T>;
};

/**
 * The workspace the load writes into. Provisional until `--workspace` (T-0021-07): the only
 * workspace there is, or a new `Principal` one in an empty database, as the workspaces
 * migration does; with more than one, the load refuses instead of guessing.
 */
async function loadWorkspace(dataSource: DataSource, dryRun: boolean): Promise<string | null> {
    const rows: { id: string }[] = await dataSource.query(
        'SELECT id FROM workspaces ORDER BY created_at LIMIT 2',
    );

    if (rows.length > 1) {
        throw new Error('the initial load cannot choose among several workspaces');
    }
    if (rows[0]) return rows[0].id;
    if (dryRun) return null;

    const [created]: { id: string }[] = await dataSource.query(
        "INSERT INTO workspaces (name) VALUES ('Principal') RETURNING id",
    );

    return created!.id;
}

/**
 * The API's environment list with only `DATABASE_URL` required (AC-0019-10): the load checks no
 * token, opens no port and starts no job worker.
 */
export const LOAD_ENV_LIST = envList.map((variable) =>
    variable.key === 'DATABASE_URL' ? variable : { ...variable, required: false },
);

/**
 * Composes the services on the API's container (spec 0019, _Comando_). The container already
 * wires the database, the transaction runner, the event dispatcher and the closed-window guard
 * the services depend on; the load replaces the environment list before anything resolves it
 * and registers the services the API registers through its modules. `dataSource` replaces the
 * process connection, as the integration tests do.
 */
export async function composeLoad(dataSource?: DataSource): Promise<LoadServices> {
    container.register(EnvListSymbol, { useValue: LOAD_ENV_LIST });
    if (dataSource) {
        container.registerInstance(DatabaseConnectionSymbol, dataSource);
    } else {
        await initializeDataSource();
    }

    container.registerSingleton(BankServiceSymbol, BankService);
    container.registerSingleton(BankAccountServiceSymbol, BankAccountService);
    container.registerSingleton(CreditCardServiceSymbol, CreditCardService);
    container.registerSingleton(ExpenseTypeServiceSymbol, ExpenseTypeService);
    container.registerSingleton(ExpenseServiceSymbol, ExpenseService);
    container.registerSingleton(EarningTypeServiceSymbol, EarningTypeService);
    container.registerSingleton(EarningServiceSymbol, EarningService);

    const requestContext = container.resolve<RequestContext>(RequestContextSymbol);
    const connection = dataSource ?? AppDataSource;

    return {
        banks: container.resolve(BankServiceSymbol),
        accounts: container.resolve(BankAccountServiceSymbol),
        cards: container.resolve(CreditCardServiceSymbol),
        expenseTypes: container.resolve(ExpenseTypeServiceSymbol),
        expenses: container.resolve(ExpenseServiceSymbol),
        earningTypes: container.resolve(EarningTypeServiceSymbol),
        earnings: container.resolve(EarningServiceSymbol),
        inWorkspace: async (work, options) => {
            const workspaceId = await loadWorkspace(connection, options.dryRun);

            return requestContext.run(
                { correlationId: 'initial-load', startedAt: Date.now(), workspaceId },
                work,
            );
        },
    };
}
