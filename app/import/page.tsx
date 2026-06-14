'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { 
  ArrowLeft, Upload, FileText, CheckCircle, AlertTriangle, 
  Trash2, Edit, Check, X, Info
} from 'lucide-react';

interface StagedExpense {
  id: string;
  sessionId: string;
  rawRowNumber: number;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'RESOLVED' | 'REJECTED';
  rawData: {
    date: string;
    description: string;
    paid_by: string;
    amount: string;
    currency: string;
    split_type: string;
    split_with: string;
    split_details: string;
    notes: string;
  };
  detectedAnomalies: string[];
}

interface UserItem {
  id: string;
  name: string;
}

export default function ImportConsole() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stagedExpenses, setStagedExpenses] = useState<StagedExpense[]>([]);
  const [report, setReport] = useState<{
    total: number;
    pending: number;
    anomalies: number;
  } | null>(null);

  const [parsing, setParsing] = useState(false);
  const [loadingStaged, setLoadingStaged] = useState(false);
  
  // Inline resolution states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPayer, setEditPayer] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCurrency, setEditCurrency] = useState('');
  const [editSplitType, setEditSplitType] = useState('');
  const [editSplitWith, setEditSplitWith] = useState('');
  const [editSplitDetails, setEditSplitDetails] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // Fetch users for override dropdowns
    fetch('/api/users')
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setUsers(data.users);
      })
      .catch((e) => console.error(e));

    // Restore sessionId from localStorage if exists
    const savedSession = localStorage.getItem('importSessionId');
    if (savedSession) {
      setSessionId(savedSession);
      fetchStaged(savedSession);
    }
  }, []);

  const fetchStaged = async (sessId: string) => {
    setLoadingStaged(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/import/staged?sessionId=${sessId}`);
      const data = await res.json();
      if (data.success) {
        setStagedExpenses(data.stagedExpenses);
        
        // Calculate report
        const total = data.stagedExpenses.length;
        const pending = data.stagedExpenses.filter((e: StagedExpense) => e.status === 'PENDING_APPROVAL').length;
        const anomalies = data.stagedExpenses.filter((e: StagedExpense) => e.detectedAnomalies.length > 0 && e.status === 'PENDING_APPROVAL').length;
        setReport({ total, pending, anomalies });
      } else {
        setErrorMessage(data.error || 'Failed to fetch staged expenses.');
      }
    } catch (err) {
      setErrorMessage('Network error fetching staged expenses.');
    } finally {
      setLoadingStaged(false);
    }
  };

  const handleUploadParse = async () => {
    setParsing(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/import/upload', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSessionId(data.sessionId);
        localStorage.setItem('importSessionId', data.sessionId);
        await fetchStaged(data.sessionId);
      } else {
        setErrorMessage(data.error || 'Failed to parse CSV file.');
      }
    } catch (err) {
      setErrorMessage('Network error initiating upload.');
    } finally {
      setParsing(false);
    }
  };

  const handleResolve = async (id: string, action: 'APPROVE' | 'REJECT' | 'RESOLVE_EDIT', overrides?: any) => {
    setResolvingId(id);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/import/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stagedExpenseId: id, action, overrides }),
      });
      const data = await res.json();
      if (data.success) {
        setEditingId(null);
        if (sessionId) await fetchStaged(sessionId);
      } else {
        setErrorMessage(data.error || 'Failed to resolve staged expense.');
      }
    } catch (err: any) {
      setErrorMessage('Error transmitting resolution request.');
    } finally {
      setResolvingId(null);
    }
  };

  const startInlineEdit = (item: StagedExpense) => {
    setEditingId(item.id);
    setEditPayer(item.rawData.paid_by);
    setEditAmount(item.rawData.amount.replace(/,/g, ''));
    setEditCurrency(item.rawData.currency || 'INR');
    setEditSplitType(item.rawData.split_type || 'equal');
    setEditSplitWith(item.rawData.split_with);
    setEditSplitDetails(item.rawData.split_details || '');
    setEditDescription(item.rawData.description);
    setEditNotes(item.rawData.notes || '');
  };

  const submitInlineEdit = (id: string) => {
    // Transform splitWith into array if comma/semicolon entered
    const splitWithArr = editSplitWith
      .split(';')
      .map(s => s.trim())
      .filter(Boolean);

    handleResolve(id, 'RESOLVE_EDIT', {
      paidBy: editPayer,
      amount: parseFloat(editAmount),
      currency: editCurrency,
      splitType: editSplitType,
      splitWith: splitWithArr,
      splitDetails: editSplitDetails,
      description: editDescription,
      notes: editNotes,
    });
  };

  const allResolved = report && report.total > 0 && report.pending === 0;

  return (
    <div className="flex flex-col min-h-screen bg-slate-900 text-slate-100 font-sans">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-slate-400 hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <span className="font-semibold text-lg bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              CSV Ingestion & Anomaly Resolver
            </span>
          </div>
          <Link href="/" className="text-xs sm:text-sm text-slate-400 hover:text-slate-200">
            Roommate Dashboard
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto px-6 py-10 w-full space-y-8">
        {/* Error Alert */}
        {errorMessage && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-sm">Operation Failed</h4>
              <p className="text-xs text-red-300/90 mt-1">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Upload Action Console */}
        <div className="bg-slate-850 border border-slate-800 rounded-3xl p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xl relative overflow-hidden">
          <div className="space-y-2 relative z-10">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <FileText className="w-6 h-6 text-indigo-400" />
              Ingestion Console
            </h2>
            <p className="text-slate-400 text-sm max-w-lg">
              Parses the server file <code className="text-indigo-300">data/expenses_export.csv</code>, staging all rows in SQLite and checking for overlaps, unregistered users, or math discrepancies.
            </p>
          </div>

          <button
            onClick={handleUploadParse}
            disabled={parsing}
            className="inline-flex items-center justify-center gap-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-medium text-base px-6 py-3.5 rounded-2xl transition-all shadow-lg shadow-indigo-600/10 cursor-pointer self-start md:self-auto"
          >
            {parsing ? (
              <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <Upload className="w-5 h-5" />
            )}
            Parse expenses_export.csv
          </button>
        </div>

        {/* All Resolved Success Notification */}
        {allResolved && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-6 rounded-3xl flex items-start gap-4 animate-fade-in shadow-lg shadow-emerald-500/5">
            <CheckCircle className="w-6 h-6 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-bold text-lg text-white">Ingestion Session Finalized!</h4>
              <p className="text-sm text-emerald-300/90">
                All CSV staged records have been successfully resolved and written to the production database ledger.
              </p>
              <div className="pt-2">
                <Link
                  href="/"
                  className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-semibold hover:underline"
                >
                  Return to Roommate Selector and enter dashboards &rarr;
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Report Card & Staged List */}
        {sessionId && (
          <div className="space-y-6">
            {report && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-850 border border-slate-800 rounded-2xl p-6 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Total Rows</span>
                    <h3 className="text-3xl font-bold text-slate-100 mt-1">{report.total}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-indigo-400 font-semibold">T</div>
                </div>
                <div className="bg-slate-850 border border-slate-800 rounded-2xl p-6 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Unresolved Pending</span>
                    <h3 className="text-3xl font-bold text-slate-100 mt-1">{report.pending}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-amber-400 font-semibold">P</div>
                </div>
                <div className="bg-slate-850 border border-slate-800 rounded-2xl p-6 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Flagged Anomaly Rows</span>
                    <h3 className="text-3xl font-bold text-red-400 mt-1">{report.anomalies}</h3>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-red-400/90 font-semibold">A</div>
                </div>
              </div>
            )}

            {/* List */}
            <div className="bg-slate-850 border border-slate-800 rounded-3xl shadow-xl overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-800 bg-slate-900 flex items-center justify-between">
                <h3 className="font-bold text-slate-200">Staging Area Grid</h3>
                <span className="text-xs text-slate-400">Session: <code className="text-indigo-400">{sessionId.slice(0, 8)}...</code></span>
              </div>

              {loadingStaged ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400 text-sm">
                  <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                  Loading staged records...
                </div>
              ) : stagedExpenses.length === 0 ? (
                <div className="py-20 text-center text-slate-500 text-sm">
                  Staging area is empty. Parse the CSV file above.
                </div>
              ) : (
                <div className="divide-y divide-slate-800/80">
                  {stagedExpenses.map((item) => {
                    const hasAnomalies = item.detectedAnomalies.length > 0;
                    const isPending = item.status === 'PENDING_APPROVAL';
                    const isEditing = editingId === item.id;
                    const isResolving = resolvingId === item.id;

                    return (
                      <div key={item.id} className={`p-6 space-y-4 transition-colors ${!isPending ? 'bg-slate-900/20' : ''}`}>
                        {/* Header Details */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-slate-500">#{item.rawRowNumber}</span>
                            <h4 className="font-semibold text-slate-200 text-base">{item.rawData.description}</h4>
                            <span className="text-xs text-slate-400">{item.rawData.date}</span>
                          </div>

                          {/* Status Badge */}
                          <div className="flex items-center gap-2">
                            {item.status === 'APPROVED' && (
                              <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-full font-medium">Approved</span>
                            )}
                            {item.status === 'RESOLVED' && (
                              <span className="text-xs bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2.5 py-1 rounded-full font-medium">Resolved & Committed</span>
                            )}
                            {item.status === 'REJECTED' && (
                              <span className="text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-2.5 py-1 rounded-full font-medium">Rejected</span>
                            )}
                            {isPending && !hasAnomalies && (
                              <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                                <Check className="w-3.5 h-3.5" /> Ready to Commit
                              </span>
                            )}
                            {isPending && hasAnomalies && (
                              <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5" /> Flagged Anomalies
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Raw Data Row details */}
                        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                          <div>
                            <span className="text-slate-500 block mb-1">Paid By:</span>
                            <span className="text-slate-300 font-medium">{item.rawData.paid_by || <em className="text-red-400">Missing</em>}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block mb-1">Amount:</span>
                            <span className="text-slate-300 font-medium">{item.rawData.amount} {item.rawData.currency || <em className="text-red-400">Missing</em>}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block mb-1">Split Type:</span>
                            <span className="text-slate-300 font-medium capitalize">{item.rawData.split_type || 'Settlement'}</span>
                          </div>
                          <div>
                            <span className="text-slate-500 block mb-1">Split With:</span>
                            <span className="text-slate-300 font-medium truncate block">{item.rawData.split_with}</span>
                          </div>
                          {item.rawData.split_details && (
                            <div className="col-span-2 md:col-span-4 border-t border-slate-800/80 pt-2 mt-2">
                              <span className="text-slate-500 block mb-1">Split Details:</span>
                              <span className="text-indigo-300 font-mono">{item.rawData.split_details}</span>
                            </div>
                          )}
                          {item.rawData.notes && (
                            <div className="col-span-2 md:col-span-4 border-t border-slate-800/80 pt-2">
                              <span className="text-slate-500 block mb-1">Notes:</span>
                              <span className="text-slate-400 italic">{item.rawData.notes}</span>
                            </div>
                          )}
                        </div>

                        {/* Anomaly Badges */}
                        {isPending && hasAnomalies && (
                          <div className="flex flex-wrap gap-2">
                            {item.detectedAnomalies.map((code) => (
                              <span key={code} className="text-[10px] uppercase font-bold tracking-wider bg-red-500/10 border border-red-500/25 text-red-400 px-2.5 py-0.5 rounded-md flex items-center gap-1.5">
                                <Info className="w-3 h-3" />
                                {code.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Editing Override Form Inline */}
                        {isEditing && (
                          <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl p-6 space-y-4 animate-slide-down">
                            <h5 className="font-semibold text-sm text-indigo-300 flex items-center gap-2 pb-2 border-b border-slate-800">
                              <Edit className="w-4 h-4" />
                              Interactive Override Form
                            </h5>
                            
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                              <div className="space-y-1">
                                <label className="text-slate-400 block font-medium">Payer (paid_by):</label>
                                <select
                                  value={editPayer}
                                  onChange={(e) => setEditPayer(e.target.value)}
                                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-indigo-500"
                                >
                                  <option value="">Select Roommate</option>
                                  {users.map((u) => (
                                    <option key={u.id} value={u.name}>{u.name}</option>
                                  ))}
                                </select>
                              </div>

                              <div className="space-y-1">
                                <label className="text-slate-400 block font-medium">Amount:</label>
                                <input
                                  type="text"
                                  value={editAmount}
                                  onChange={(e) => setEditAmount(e.target.value)}
                                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-indigo-500"
                                />
                              </div>

                              <div className="space-y-1">
                                <label className="text-slate-400 block font-medium">Currency:</label>
                                <select
                                  value={editCurrency}
                                  onChange={(e) => setEditCurrency(e.target.value)}
                                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-indigo-500"
                                >
                                  <option value="INR">INR</option>
                                  <option value="USD">USD</option>
                                </select>
                              </div>

                              <div className="space-y-1">
                                <label className="text-slate-400 block font-medium">Split Type:</label>
                                <select
                                  value={editSplitType}
                                  onChange={(e) => setEditSplitType(e.target.value)}
                                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-indigo-500"
                                >
                                  <option value="equal">Equal</option>
                                  <option value="unequal">Unequal</option>
                                  <option value="percentage">Percentage</option>
                                  <option value="share">Share</option>
                                </select>
                              </div>

                              <div className="space-y-1 md:col-span-2">
                                <label className="text-slate-400 block font-medium">Split With (Semi-colon separated user names):</label>
                                <input
                                  type="text"
                                  value={editSplitWith}
                                  onChange={(e) => setEditSplitWith(e.target.value)}
                                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 font-mono outline-none focus:border-indigo-500"
                                />
                              </div>

                              <div className="space-y-1 md:col-span-3">
                                <label className="text-slate-400 block font-medium">Split Details (e.g., percentages, shares or raw amounts):</label>
                                <input
                                  type="text"
                                  value={editSplitDetails}
                                  onChange={(e) => setEditSplitDetails(e.target.value)}
                                  placeholder="Rohan 700; Priya 400 or Aisha 30%; Rohan 30%"
                                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 font-mono outline-none focus:border-indigo-500"
                                />
                              </div>

                              <div className="space-y-1 md:col-span-3">
                                <label className="text-slate-400 block font-medium">Description:</label>
                                <input
                                  type="text"
                                  value={editDescription}
                                  onChange={(e) => setEditDescription(e.target.value)}
                                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-indigo-500"
                                />
                              </div>
                            </div>

                            <div className="flex gap-2 justify-end pt-3">
                              <button
                                onClick={() => setEditingId(null)}
                                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-semibold text-slate-300 transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => submitInlineEdit(item.id)}
                                disabled={isResolving}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 rounded-xl text-xs font-semibold text-white transition-all shadow-md shadow-indigo-600/10"
                              >
                                {isResolving ? 'Resolving...' : 'Commit Overrides'}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Action buttons footer for pending rows */}
                        {isPending && !isEditing && (
                          <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-slate-800/40">
                            {/* Reject Button */}
                            <button
                              onClick={() => handleResolve(item.id, 'REJECT')}
                              disabled={isResolving}
                              className="inline-flex items-center gap-1.5 bg-red-500/15 border border-red-500/25 hover:bg-red-500/25 text-red-400 text-xs font-semibold px-3 py-2 rounded-xl transition-all"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Reject Row
                            </button>

                            {/* Edit/Resolve button */}
                            <button
                              onClick={() => startInlineEdit(item)}
                              className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-700 transition-all"
                            >
                              <Edit className="w-3.5 h-3.5" /> Interactive Resolve
                            </button>

                            {/* Approve button */}
                            <button
                              onClick={() => handleResolve(item.id, 'APPROVE')}
                              disabled={isResolving || hasAnomalies}
                              className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-850 disabled:text-slate-500 disabled:border-transparent text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-md shadow-emerald-600/5 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" /> Quick Approve
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/50 bg-slate-950 py-8 text-center text-slate-500 text-xs mt-12">
        <p>© 2026 SplitSmart Roommate Settlement Engine. Built for Spreetail.</p>
      </footer>
    </div>
  );
}
