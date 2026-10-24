import { createRootRoute, Outlet } from '@tanstack/react-router';
import { StoreProvider } from '../store';

export const Route = createRootRoute({ component: () => <StoreProvider><Outlet /></StoreProvider> });
