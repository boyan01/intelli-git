import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { LocalChangesView } from './components/local-changes/LocalChangesView';
import { GitLogView } from './components/git-log/GitLogView';
import { ConflictResolverPage } from './components/merge/ConflictResolver';
import './index.css';

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
            <Route path="/conflict-resolver" element={<ConflictResolverPage />} />
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
