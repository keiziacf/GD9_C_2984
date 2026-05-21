import postgres from 'postgres';
import {
  CustomerField,
  CustomersTableType,
  InvoiceForm,
  LatestInvoice,
  InvoicesTable,
  LatestInvoiceRaw,
  Revenue,
} from './definitions';
import { formatCurrency } from './utils';
import {
  invoices as placeholderInvoices,
  customers as placeholderCustomers,
  revenue as placeholderRevenue,
} from './placeholder-data';
import {
  fetchLocalCardData,
  fetchLocalCustomerFields,
  fetchLocalCustomers,
  fetchLocalFilteredInvoices,
  fetchLocalInvoiceById,
  fetchLocalInvoicesPages,
  fetchLocalLatestInvoices,
} from './local-store';

let sqlClient: ReturnType<typeof postgres> | null = null;

function getSql() {
  if (!process.env.POSTGRES_URL) {
    return null;
  }

  if (!sqlClient) {
    sqlClient = postgres(process.env.POSTGRES_URL, { ssl: 'require' });
  }

  return sqlClient;
}

function getFilteredPlaceholderInvoices(query: string): InvoicesTable[] {
  const normalizedQuery = query.toLowerCase();

  return placeholderInvoices
    .map((invoice, index) => {
      const customer = placeholderCustomers.find(
        (item) => item.id === invoice.customer_id,
      );

      return {
        id: `${invoice.customer_id}-${invoice.date}-${index}`,
        customer_id: invoice.customer_id,
        name: customer?.name ?? 'Unknown Customer',
        email: customer?.email ?? 'unknown@example.com',
        image_url: customer?.image_url ?? '/customers/rabbit-cartoon.svg',
        date: invoice.date,
        amount: invoice.amount,
        status: invoice.status as InvoicesTable['status'],
      };
    })
    .filter((invoice) => {
      if (!normalizedQuery) {
        return true;
      }

      return (
        invoice.name.toLowerCase().includes(normalizedQuery) ||
        invoice.email.toLowerCase().includes(normalizedQuery) ||
        invoice.amount.toString().includes(normalizedQuery) ||
        invoice.date.toLowerCase().includes(normalizedQuery) ||
        invoice.status.toLowerCase().includes(normalizedQuery)
      );
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function getLatestPlaceholderInvoices(): LatestInvoice[] {
  return [...placeholderInvoices]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5)
    .map((invoice, index) => {
      const customer = placeholderCustomers.find(
        (item) => item.id === invoice.customer_id,
      );

      return {
        id: `${invoice.customer_id}-${invoice.date}-${index}`,
        name: customer?.name ?? 'Unknown Customer',
        email: customer?.email ?? 'unknown@example.com',
        image_url: customer?.image_url ?? '/customers/rabbit-cartoon.svg',
        amount: formatCurrency(invoice.amount),
      };
    });
}

export async function fetchRevenue(): Promise<Revenue[]> {
  const sql = getSql();

  if (!sql) {
    return placeholderRevenue;
  }

  try {
    // Artificially delay a response for demo purposes.
    // Don't do this in production :)

    // console.log('Fetching revenue data...');
    // await new Promise((resolve) => setTimeout(resolve, 3000));

    const data = await sql<Revenue[]>`SELECT * FROM revenue`;

    // console.log('Data fetch completed after 3 seconds.');

    return data;
  } catch (error) {
    console.error('Database Error:', error);
    return placeholderRevenue;
  }
}

export async function fetchLatestInvoices() {
  const sql = getSql();

  if (!sql) {
    return fetchLocalLatestInvoices();
  }

  try {
    const data = (await sql<LatestInvoiceRaw[]>`
      SELECT invoices.amount, customers.name, customers.image_url, customers.email, invoices.id
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      ORDER BY invoices.date DESC
      LIMIT 5`) as LatestInvoiceRaw[];

    const latestInvoices = data.map((invoice) => ({
      ...invoice,
      amount: formatCurrency(invoice.amount),
    }));
    return latestInvoices;
  } catch (error) {
    console.error('Database Error:', error);
    return getLatestPlaceholderInvoices();
  }
}

export async function fetchCardData() {
  const sql = getSql();

  if (!sql) {
    return fetchLocalCardData();
  }

  try {
    // You can probably combine these into a single SQL query
    // However, we are intentionally splitting them to demonstrate
    // how to initialize multiple queries in parallel with JS.
    const invoiceCountPromise = sql`SELECT COUNT(*) FROM invoices`;
    const customerCountPromise = sql`SELECT COUNT(*) FROM customers`;
    const invoiceStatusPromise = sql`SELECT
         SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS "paid",
         SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS "pending"
         FROM invoices`;

    const data = await Promise.all([
      invoiceCountPromise,
      customerCountPromise,
      invoiceStatusPromise,
    ]);

    const numberOfInvoices = Number(data[0][0].count ?? '0');
    const numberOfCustomers = Number(data[1][0].count ?? '0');
    const totalPaidInvoices = formatCurrency(data[2][0].paid ?? '0');
    const totalPendingInvoices = formatCurrency(data[2][0].pending ?? '0');

    return {
      numberOfCustomers,
      numberOfInvoices,
      totalPaidInvoices,
      totalPendingInvoices,
    };
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch card data.');
  }
}

const ITEMS_PER_PAGE = 6;
export async function fetchFilteredInvoices(
  query: string,
  currentPage: number,
) {
  const offset = (currentPage - 1) * ITEMS_PER_PAGE;
  const sql = getSql();

  if (!sql) {
    return fetchLocalFilteredInvoices(query, currentPage, ITEMS_PER_PAGE);
  }

  try {
    const invoices = (await sql<InvoicesTable[]>`
      SELECT
        invoices.id,
        invoices.amount,
        invoices.date,
        invoices.status,
        customers.name,
        customers.email,
        customers.image_url
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      WHERE
        customers.name ILIKE ${`%${query}%`} OR
        customers.email ILIKE ${`%${query}%`} OR
        invoices.amount::text ILIKE ${`%${query}%`} OR
        invoices.date::text ILIKE ${`%${query}%`} OR
        invoices.status ILIKE ${`%${query}%`}
      ORDER BY invoices.date DESC
      LIMIT ${ITEMS_PER_PAGE} OFFSET ${offset}
    `) as InvoicesTable[];

    return invoices;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch invoices.');
  }
}

export async function fetchInvoicesPages(query: string) {
  const sql = getSql();

  if (!sql) {
    return fetchLocalInvoicesPages(query, ITEMS_PER_PAGE);
  }

  try {
    const data = await sql`SELECT COUNT(*)
    FROM invoices
    JOIN customers ON invoices.customer_id = customers.id
    WHERE
      customers.name ILIKE ${`%${query}%`} OR
      customers.email ILIKE ${`%${query}%`} OR
      invoices.amount::text ILIKE ${`%${query}%`} OR
      invoices.date::text ILIKE ${`%${query}%`} OR
      invoices.status ILIKE ${`%${query}%`}
  `;

    const totalPages = Math.ceil(Number(data[0].count) / ITEMS_PER_PAGE);
    return totalPages;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch total number of invoices.');
  }
}

export async function fetchInvoiceById(id: string) {
  const sql = getSql();

  if (!sql) {
    return fetchLocalInvoiceById(id);
  }

  try {
    const data = await sql<InvoiceForm[]>`
      SELECT
        invoices.id,
        invoices.customer_id,
        invoices.amount,
        invoices.status
      FROM invoices
      WHERE invoices.id = ${id};
    `;

    const invoice = (data as InvoiceForm[]).map((invoice) => ({
      ...invoice,
      // Convert amount from cents to dollars
      amount: invoice.amount / 100,
    }));

    return invoice[0];
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch invoice.');
  }
}

export async function fetchCustomers() {
  const sql = getSql();

  if (!sql) {
    return fetchLocalCustomerFields();
  }

  try {
    const customers = await sql<CustomerField[]>`
      SELECT
        id,
        name
      FROM customers
      ORDER BY name ASC
    `;

    return customers;
  } catch (err) {
    console.error('Database Error:', err);
    throw new Error('Failed to fetch all customers.');
  }
}

export async function fetchFilteredCustomers(query: string) {
  const sql = getSql();

  if (!sql) {
    return fetchLocalCustomers(query);
  }

  try {
    const data = (await sql<CustomersTableType[]>`
		SELECT
		  customers.id,
		  customers.name,
		  customers.email,
		  customers.image_url,
		  COUNT(invoices.id) AS total_invoices,
		  SUM(CASE WHEN invoices.status = 'pending' THEN invoices.amount ELSE 0 END) AS total_pending,
		  SUM(CASE WHEN invoices.status = 'paid' THEN invoices.amount ELSE 0 END) AS total_paid
		FROM customers
		LEFT JOIN invoices ON customers.id = invoices.customer_id
		WHERE
		  customers.name ILIKE ${`%${query}%`} OR
        customers.email ILIKE ${`%${query}%`}
		GROUP BY customers.id, customers.name, customers.email, customers.image_url
		ORDER BY customers.name ASC
	  `) as CustomersTableType[];

    const customers = data.map((customer) => ({
      ...customer,
      total_pending: formatCurrency(customer.total_pending),
      total_paid: formatCurrency(customer.total_paid),
    }));

    return customers;
  } catch (err) {
    console.error('Database Error:', err);
    throw new Error('Failed to fetch customer table.');
  }
}
