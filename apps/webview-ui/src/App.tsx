import { HashRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { LocalChangesView } from './components/local-changes/LocalChangesView';
import { GitLogView } from './components/git-log/GitLogView';
import './index.css';

function AppContent() {
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        const initialRoute = window.initialRoute;
        if (initialRoute && location.pathname !== initialRoute) {
            navigate(initialRoute);
        }
    }, [navigate, location]);

    return (
        <Routes>
            <Route path="/" element={<LocalChangesView />} />
            <Route path="/git-log" element={<GitLogView />} />
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
