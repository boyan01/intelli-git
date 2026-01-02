import { HashRouter, Routes, Route } from 'react-router-dom';
import { CommitView } from './components/commit/CommitView';
import { PushView } from './components/push/PushView';
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
            <Route path="/" element={<CommitView />} />
            <Route path="/push" element={<PushView />} />
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
