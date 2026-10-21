import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { LocalChangesView } from './components/local-changes/LocalChangesView';
import { GitLogView } from './components/git-log/GitLogView';
import './index.css';

// Keep the merge editor and Monaco out of the commit and log view bundle.
const ConflictResolverPage = lazy(() =>
    import('./components/merge/ConflictResolver').then((module) => ({ default: module.ConflictResolverPage }))
);

function AppContent() {
    const navigate = useNavigate();
    const location = useLocation();
    const initialRoute = window.initialRoute;

    useEffect(() => {
        if (initialRoute && location.pathname !== initialRoute) {
            navigate(initialRoute);
        }
    }, [initialRoute, navigate, location]);

    if (initialRoute && location.pathname !== initialRoute) {
        return null;
    }

    return (
        <Routes>
            <Route path="/" element={<LocalChangesView />} />
            <Route path="/git-log" element={<GitLogView />} />
            <Route
                path="/conflict-resolver"
                element={
                    <Suspense fallback={null}>
                        <ConflictResolverPage />
                    </Suspense>
                }
            />
        </Routes>
    );
}

function App() {
    return (
        <HashRouter>
            <AppContent />
        </HashRouter>
    );
}

export default App;
