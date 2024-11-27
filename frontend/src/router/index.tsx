import { createBrowserRouter, Outlet, RouterProvider } from 'react-router-dom';

import ProtectedRoute from '../components/Auth/ProtectedRoute';
import Layout from '../components/Layout';
import HomePage from '../pages/Home';
import ArticlePage from '../pages/Articles';
import LoginPage from '../pages/Login';
import RegisterPage from '../pages/Register';
import PreferencesPage from '../pages/Preferences';

const RootLayout = () => {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
};

const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: 'articles/:id',
        element: <ArticlePage />,
      },
      {
        path: 'login',
        element: <LoginPage />,
      },
      {
        path: 'register',
        element: <RegisterPage />,
      },
      {
        path: 'preferences',
        element: (
          <ProtectedRoute>
            <PreferencesPage />
          </ProtectedRoute>
        ),
      },
    ],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
