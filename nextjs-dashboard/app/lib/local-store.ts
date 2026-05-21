import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import {
  CustomerField,
  FormattedCustomersTable,
  InvoiceForm,
  InvoicesTable,
  LatestInvoice,
} from './definitions';
import {
  customers as placeholderCustomers,
  invoices as placeholderInvoices,
} from './placeholder-data';
import { formatCurrency } from './utils';

type InvoiceStatus = 'pending' | 'paid';

type StoredInvoice = {
  id: string;
  customer_id: string;
  amount: number;
  status: InvoiceStatus;
  date: string;
};

type InvoiceMutation = {
  customerId: string;
  amountInCents: number;
  status: InvoiceStatus;
};

const dataDirectory = path.join(process.cwd(), '.local-data');
const invoicesFile = path.join(dataDirectory, 'invoices.json');

function seedInvoices(): StoredInvoice[] {
  return placeholderInvoices.map((invoice, index) => ({
    id: `${invoice.customer_id}-${invoice.date}-${index}`,
    customer_id: invoice.customer_id,
    amount: invoice.amount,
    status: invoice.status as InvoiceStatus,
    date: invoice.date,
  }));
}

async function writeInvoices(invoices: StoredInvoice[]) {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(invoicesFile, JSON.stringify(invoices, null, 2));
}

async function readInvoices() {
  try {
    const data = await readFile(invoicesFile, 'utf8');
    return JSON.parse(data) as StoredInvoice[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    const seededInvoices = seedInvoices();
    await writeInvoices(seededInvoices);
    return seededInvoices;
  }
}

function findCustomer(customerId: string) {
  return placeholderCustomers.find((customer) => customer.id === customerId);
}

function toInvoiceTableRow(invoice: StoredInvoice): InvoicesTable {
  const customer = findCustomer(invoice.customer_id);

  return {
    id: invoice.id,
    customer_id: invoice.customer_id,
    name: customer?.name ?? 'Unknown Customer',
    email: customer?.email ?? 'unknown@example.com',
    image_url: customer?.image_url ?? '/customers/rabbit-cartoon.svg',
    date: invoice.date,
    amount: invoice.amount,
    status: invoice.status,
  };
}

function filteredInvoiceRows(query: string, invoices: StoredInvoice[]) {
  const normalizedQuery = query.toLowerCase();

  return invoices
    .map(toInvoiceTableRow)
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

export async function fetchLocalFilteredInvoices(
  query: string,
  currentPage: number,
  itemsPerPage: number,
) {
  const offset = (currentPage - 1) * itemsPerPage;
  const invoices = await readInvoices();

  return filteredInvoiceRows(query, invoices).slice(
    offset,
    offset + itemsPerPage,
  );
}

export async function fetchLocalInvoicesPages(
  query: string,
  itemsPerPage: number,
) {
  const invoices = await readInvoices();

  return Math.ceil(filteredInvoiceRows(query, invoices).length / itemsPerPage);
}

export async function fetchLocalInvoiceById(id: string): Promise<
  InvoiceForm | undefined
> {
  const invoices = await readInvoices();
  const invoice = invoices.find((item) => item.id === id);

  if (!invoice) {
    return undefined;
  }

  return {
    id: invoice.id,
    customer_id: invoice.customer_id,
    amount: invoice.amount / 100,
    status: invoice.status,
  };
}

export async function fetchLocalLatestInvoices(): Promise<LatestInvoice[]> {
  const invoices = await readInvoices();

  return filteredInvoiceRows('', invoices)
    .slice(0, 5)
    .map((invoice) => ({
      id: invoice.id,
      name: invoice.name,
      email: invoice.email,
      image_url: invoice.image_url,
      amount: formatCurrency(invoice.amount),
    }));
}

export async function fetchLocalCardData() {
  const invoices = await readInvoices();

  return {
    numberOfCustomers: placeholderCustomers.length,
    numberOfInvoices: invoices.length,
    totalPaidInvoices: formatCurrency(
      invoices
        .filter((invoice) => invoice.status === 'paid')
        .reduce((sum, invoice) => sum + invoice.amount, 0),
    ),
    totalPendingInvoices: formatCurrency(
      invoices
        .filter((invoice) => invoice.status === 'pending')
        .reduce((sum, invoice) => sum + invoice.amount, 0),
    ),
  };
}

export async function fetchLocalCustomers(
  query: string,
): Promise<FormattedCustomersTable[]> {
  const invoices = await readInvoices();
  const normalizedQuery = query.toLowerCase();

  return placeholderCustomers
    .filter(
      (customer) =>
        !normalizedQuery ||
        customer.name.toLowerCase().includes(normalizedQuery) ||
        customer.email.toLowerCase().includes(normalizedQuery),
    )
    .map((customer) => {
      const customerInvoices = invoices.filter(
        (invoice) => invoice.customer_id === customer.id,
      );
      const totalPending = customerInvoices
        .filter((invoice) => invoice.status === 'pending')
        .reduce((sum, invoice) => sum + invoice.amount, 0);
      const totalPaid = customerInvoices
        .filter((invoice) => invoice.status === 'paid')
        .reduce((sum, invoice) => sum + invoice.amount, 0);

      return {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        image_url: customer.image_url,
        total_invoices: customerInvoices.length,
        total_pending: formatCurrency(totalPending),
        total_paid: formatCurrency(totalPaid),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function fetchLocalCustomerFields(): CustomerField[] {
  return placeholderCustomers
    .map((customer) => ({
      id: customer.id,
      name: customer.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createLocalInvoice({
  customerId,
  amountInCents,
  status,
}: InvoiceMutation) {
  const invoices = await readInvoices();

  invoices.unshift({
    id: randomUUID(),
    customer_id: customerId,
    amount: amountInCents,
    status,
    date: new Date().toISOString().split('T')[0],
  });

  await writeInvoices(invoices);
}

export async function updateLocalInvoice(
  id: string,
  { customerId, amountInCents, status }: InvoiceMutation,
) {
  const invoices = await readInvoices();
  const nextInvoices = invoices.map((invoice) =>
    invoice.id === id
      ? {
          ...invoice,
          customer_id: customerId,
          amount: amountInCents,
          status,
        }
      : invoice,
  );

  await writeInvoices(nextInvoices);
}

export async function deleteLocalInvoice(id: string) {
  const invoices = await readInvoices();
  await writeInvoices(invoices.filter((invoice) => invoice.id !== id));
}
