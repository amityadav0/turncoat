import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading } from './components/bits';
import Home from './pages/Home';
import { copy } from './content/copy';

function Crashed() {
  return (
    <main className="wrap" style={{ paddingTop: 48 }}>
      <h1>{copy.common.crashedTitle}</h1>
      <p className="lede">
        {copy.common.crashedBody} <a href="/">{copy.common.crashedLink}</a>.
      </p>
    </main>
  );
}

const Live = lazy(() => import('./pages/Live'));
const Practice = lazy(() => import('./pages/Practice'));
const Library = lazy(() => import('./pages/Library'));
const LibraryRound = lazy(() => import('./pages/LibraryRound'));
const Prelaunch = lazy(() => import('./pages/Prelaunch'));
const Fairness = lazy(() => import('./pages/Fairness'));
const NotFound = lazy(() => import('./pages/NotFound'));

const page = (el: JSX.Element) => <Suspense fallback={<Loading />}>{el}</Suspense>;

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <Crashed />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/live', element: page(<Live />) },
      { path: '/practice', element: page(<Practice />) },
      { path: '/library', element: page(<Library />) },
      { path: '/library/prelaunch', element: page(<Prelaunch />) },
      { path: '/library/:id', element: page(<LibraryRound />) },
      { path: '/fairness', element: page(<Fairness />) },
      { path: '*', element: page(<NotFound />) },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
