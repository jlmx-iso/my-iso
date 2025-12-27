# my-iso

A modern photographer marketplace and social platform where photographers can showcase their portfolios, connect with clients, and manage bookings.

## Features

- **Photographer Portfolios**: Showcase work with Cloudinary-powered image galleries
- **User Authentication**: Secure login and registration with NextAuth.js
- **Messaging System**: Real-time communication between photographers and clients
- **Event Management**: Create, browse, and manage photography events
- **Search & Discovery**: Find photographers by location, style, and availability
- **Subscription Plans**: Tiered pricing with Stripe integration
- **Social Features**: Favorites, profiles, and user interactions

## Tech Stack

This project is built with the [T3 Stack](https://create.t3.gg/):

- [Next.js](https://nextjs.org) - React framework with App Router
- [NextAuth.js](https://next-auth.js.org) - Authentication
- [Prisma](https://prisma.io) - Type-safe ORM
- [Tailwind CSS](https://tailwindcss.com) - Utility-first CSS
- [tRPC](https://trpc.io) - End-to-end type safety
- [Mantine](https://mantine.dev) - React component library

Additional integrations:
- PostgreSQL database
- Cloudinary for image management
- Supabase for storage
- Stripe for payments
- Postmark for transactional emails
- PostHog for analytics

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Yarn package manager

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   yarn install
   ```

3. Set up environment variables (copy `.env.example` to `.env`)

4. Initialize the database:
   ```bash
   yarn db:push
   ```

5. Run the development server:
   ```bash
   yarn dev
   ```

6. Open [http://localhost:3000](http://localhost:3000)

## Development

- `yarn dev` - Start development server
- `yarn build` - Build for production
- `yarn start` - Start production server
- `yarn lint` - Run ESLint
- `yarn db:studio` - Open Prisma Studio
- `yarn db:push` - Push schema changes to database

## Project Structure

See [Claude.md](./Claude.md) for detailed documentation on:
- Project architecture
- Coding patterns and conventions
- API design guidelines
- Component organization

## License

Private - All rights reserved
