import { HashRouter, Routes, Route } from 'react-router-dom';
import { LocalChangesView } from './components/local-changes/LocalChangesView';
import { GitLogView } from './components/git-log/GitLogView';
import './index.css';

import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';

function AppContent() {
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        const initialRoute = (window as any).initialRoute;
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
