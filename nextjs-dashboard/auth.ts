import bcrypt from 'bcrypt';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import postgres from 'postgres';
import { z } from 'zod';
import { authConfig } from './auth.config';
import type { User } from '@/app/lib/definitions';
import { users as placeholderUsers } from '@/app/lib/placeholder-data';

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

async function getUser(email: string): Promise<User | undefined> {
  const sql = getSql();

  if (!sql) {
    return placeholderUsers.find((user) => user.email === email);
  }

  try {
    const user = await sql<User[]>`SELECT * FROM users WHERE email = ${email}`;
    return user[0];
  } catch (error) {
    console.error('Failed to fetch user:', error);
    throw new Error('Failed to fetch user.');
  }
}

async function passwordMatches(password: string, storedPassword: string) {
  if (storedPassword.startsWith('$2')) {
    return bcrypt.compare(password, storedPassword);
  }

  return password === storedPassword;
}

export const { auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsedCredentials = z
          .object({ email: z.string().email(), password: z.string().min(6) })
          .safeParse(credentials);

        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;
          const user = await getUser(email);

          if (!user) {
            return null;
          }

          const passwordsMatch = await passwordMatches(password, user.password);

          if (passwordsMatch) {
            return {
              id: user.id,
              name: user.name,
              email: user.email,
            };
          }
        }

        console.log('Invalid credentials');
        return null;
      },
    }),
  ],
});
