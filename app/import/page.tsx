'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle,
  Edit,
  FileText,
  Filter,
  Home,
  Info,
  RefreshCw,
  Table,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';

interface RawData {
  date: string;
  description: string;
  paid_by: string;
  amount: string;
  currency: string;
  split_type: string;
  split_with: string;
  split_details: string;
  notes: string;
}

interface ResolvedData {
  date: string;
  description: string;
  paidBy: string;
  amount: number;
  currency: string;
  exchangeRate?: number;
  splitType: 'equal' | 'unequal' | 'percentage' | 'share';
  splitWith: string[];
  splitDetails: string;
  notes: string;
  isSettlement: boolean;
}

interface StagedExpense {
  id: string;
  rawRowNumber: number;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'RESOLVED' | 'REJECTED';
  rawData: RawData;
  resolvedData: ResolvedData | null;
  resolutionSummary: string | null;
  resolutionMode: string | null;
  committedExpenseId: string | null;
  detectedAnomalies: string[];
}

interface UserItem {
  id: string;
  name: string;
}

interface AnomalyDefinition {
  code: string;
  label: string;
  shortLabel: string;
  description: string;
  policy: string;
  canApplyPolicy: boolean;
  manualHint: string;
}

interface BreakdownItem {
  code: string;
  definition: AnomalyDefinition;
  total: number;
  pending: number;
  resolved: number;
  rejected: number;
}

interface ImportReport {
  totalRows: number;
  pending: number;
  resolved: number;
  rejected: number;
  anomalyRows: number;
  cleanRows: number;
  breakdown: BreakdownItem[];
}

interface EditState {
  date: string;
  description: string;
  paidBy: string;
  amount: string;
  currency: string;
  exchangeRate: string;
  splitType: 'equal' | 'unequal' | 'percentage' | 'share';
  splitWith: string[];
  splitValues: Record<string, string>;
  notes: string;
  isSettlement: boolean;
}

const statusLabels: Record<StagedExpense['status'], string> = {
  PENDING_APPROVAL: 'Pending',
  APPROVED: 'Approved',
  RESOLVED: 'Resolved',
  REJECTED: 'Rejected',
};

export default function ImportConsole() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCongratsModal, setShowCongratsModal] = useState(false);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stagedExpenses, setStagedExpenses] = useState<StagedExpense[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [definitions, setDefinitions] = useState<Record<string, AnomalyDefinition>>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [activeAnomaly, setActiveAnomaly] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<any[]>([]);
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);

  const filteredRows = useMemo(() => {
    return stagedExpenses.filter((item) => {
      const anomalyMatch = activeAnomaly === 'ALL' || item.detectedAnomalies.includes(activeAnomaly);
      const statusMatch = statusFilter === 'ALL' || item.status === statusFilter;
      return anomalyMatch && statusMatch;
    });
  }, [activeAnomaly, stagedExpenses, statusFilter]);

  const [dashboardGroupId, setDashboardGroupId] = useState<string | null>(null);

  useEffect(() => {
    const savedSessionId = localStorage.getItem('importSessionId');
    if (savedSessionId) setSessionId(savedSessionId);

    fetch('/api/groups')
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.groups?.length > 0) {
          setDashboardGroupId(data.groups[0].id);
        }
      })
      .catch((e) => console.error('Error fetching groups:', e));
  }, []);

  const autoSupported = (item: StagedExpense) => {
    if (item.detectedAnomalies.length === 0) return true;
    return item.detectedAnomalies.every((code) => definitions[code]?.canApplyPolicy);
  };

  const fetchStaged = useCallback(async (sessId: string, silent = false) => {
    if (!silent) setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/import/staged?sessionId=${sessId}`);
      const data = await res.json();
      if (!data.success) {
        setErrorMessage(data.error || 'Failed to fetch staged expenses.');
        return;
      }
      setStagedExpenses(data.stagedExpenses);
      setReport(data.report);
      setDefinitions(data.anomalyDefinitions || {});
      if (data.memberships) setMemberships(data.memberships);
    } catch {
      setErrorMessage('Network error while loading staged expenses.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((data) => { if (data.success) setUsers(data.users); })
      .catch(console.error);

    if (sessionId) {
      void Promise.resolve().then(() => fetchStaged(sessionId, false));
    }
  }, [fetchStaged, sessionId]);

  useEffect(() => {
    if (report && report.totalRows > 0 && report.pending === 0) {
      setShowCongratsModal(true);
    }
  }, [report]);

  const handleUploadParse = async () => {
    setBusyKey('upload');
    setErrorMessage(null);
    try {
      const options: RequestInit = { method: 'POST' };
      if (selectedFile) {
        const formData = new FormData();
        formData.append('file', selectedFile);
        options.body = formData;
      }
      const res = await fetch('/api/import/upload', options);
      const data = await res.json();
      if (!data.success) {
        setErrorMessage(data.details || data.error || 'Failed to parse CSV.');
        return;
      }
      setSessionId(data.sessionId);
      localStorage.setItem('importSessionId', data.sessionId);
      setActiveAnomaly('ALL');
      setStatusFilter('ALL');
      await fetchStaged(data.sessionId, false);
    } catch {
      setErrorMessage('Network error while importing CSV.');
    } finally {
      setBusyKey(null);
    }
  };

  const resolveRow = async (
    id: string,
    action: 'APPROVE' | 'REJECT' | 'RESOLVE_EDIT' | 'APPLY_POLICY',
    overrides?: Record<string, unknown>
  ) => {
    setBusyKey(`${action}-${id}`);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/import/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stagedExpenseId: id, action, overrides }),
      });
      const data = await res.json();
      if (!data.success) {
        setErrorMessage(data.error || 'Resolution failed.');
        return;
      }
      setEditingId(null);
      setEditState(null);
      if (sessionId) await fetchStaged(sessionId, true);
    } catch {
      setErrorMessage('Network error while resolving row.');
    } finally {
      setBusyKey(null);
    }
  };

  const applyCategoryPolicy = async (anomalyCode: string) => {
    if (!sessionId) return;
    setBusyKey(`category-${anomalyCode}`);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/import/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'APPLY_CATEGORY_POLICY', sessionId, anomalyCode }),
      });
      const data = await res.json();
      if (!data.success) {
        setErrorMessage(data.error || 'Category policy failed.');
        return;
      }
      if (data.skipped?.length) {
        setErrorMessage(`${data.skipped.length} row(s) still need manual review. First: row ${data.skipped[0].rowNumber} - ${data.skipped[0].reason}`);
      }
      await fetchStaged(sessionId, true);
    } catch {
      setErrorMessage('Network error while applying category policy.');
    } finally {
      setBusyKey(null);
    }
  };

  const startEdit = (item: StagedExpense) => {
    const source = item.resolvedData || rowToResolvedData(item.rawData);
    setEditingId(item.id);
    setEditState({
      date: normalizeDateForInput(source.date),
      description: source.description,
      paidBy: source.paidBy,
      amount: String(source.amount),
      currency: source.currency || 'INR',
      exchangeRate: source.exchangeRate ? String(source.exchangeRate) : '',
      splitType: source.splitType || 'equal',
      splitWith: source.splitWith || [],
      splitValues: parseSplitValues(source.splitDetails),
      notes: source.notes || '',
      isSettlement: Boolean(source.isSettlement),
    });
    setTimeout(() => {
      document.getElementById(`editor-${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  };

  const toggleParticipant = (name: string) => {
    setEditState((current) => {
      if (!current) return current;
      const exists = current.splitWith.includes(name);
      const splitWith = exists
        ? current.splitWith.filter((item) => item !== name)
        : [...current.splitWith, name];
      return { ...current, splitWith };
    });
  };

  const updateSplitValue = (name: string, value: string) => {
    setEditState((current) => current ? {
      ...current,
      splitValues: { ...current.splitValues, [name]: value },
    } : current);
  };

  const submitEdit = (id: string) => {
    if (!editState) return;
    resolveRow(id, 'RESOLVE_EDIT', {
      paidBy: editState.paidBy,
      amount: Number(editState.amount),
      currency: editState.currency,
      exchangeRate: editState.exchangeRate ? Number(editState.exchangeRate) : undefined,
      splitType: editState.splitType,
      splitWith: editState.splitWith,
      splitDetails: buildSplitDetails(editState),
      description: editState.description,
      date: editState.date,
      notes: editState.notes,
      isSettlement: editState.isSettlement,
    });
  };

  const allDone = report && report.totalRows > 0 && report.pending === 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2 font-semibold text-slate-800">
            <Home className="h-4 w-4 text-indigo-600" />
            CSV Anomaly Resolver
          </div>
          {dashboardGroupId ? (
            <Link
              href={`/groups/${dashboardGroupId}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 border border-indigo-150 px-3 py-1.5 text-xs font-semibold text-indigo-750 hover:text-indigo-900 transition-all cursor-pointer shadow-xs"
            >
              <Users className="w-3.5 h-3.5 text-indigo-600" />
              Go to Roommate Dashboard
            </Link>
          ) : (
            <span className="text-xs text-slate-400 italic">Finding group...</span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {errorMessage && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="flex items-center gap-2 text-xl font-bold text-slate-950">
                <FileText className="h-5 w-5 text-indigo-600" />
                Import Review Console
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Every CSV row is staged first. Ledger writes happen only after approval, policy action, or manual edit.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <Upload className="h-4 w-4 text-indigo-600 pointer-events-none" />
                <span className="truncate pointer-events-none">{selectedFile ? selectedFile.name : 'Choose CSV'}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              />

              <button
                onClick={handleUploadParse}
                disabled={busyKey === 'upload'}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:bg-slate-300 cursor-pointer"
              >
                {busyKey === 'upload' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {selectedFile ? 'Parse Selected CSV' : 'Parse Sample CSV'}
              </button>
            </div>
          </div>
        </section>

        {report && (
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Metric label="Rows" value={report.totalRows} />
            <Metric label="Anomaly Rows" value={report.anomalyRows} tone="red" />
            <Metric label="Pending" value={report.pending} tone="amber" />
            <Metric label="Resolved" value={report.resolved} tone="emerald" />
            <Metric label="Rejected" value={report.rejected} tone="slate" />
          </section>
        )}

        {allDone && (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <CheckCircle className="mt-0.5 h-5 w-5 shrink-0" />
            All staged rows have been resolved or rejected.
          </div>
        )}

        {report && (
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="flex items-center gap-2 font-bold text-slate-950">
                  <Filter className="h-4 w-4 text-indigo-600" />
                  Anomaly Breakdown
                </h2>
                <p className="mt-1 text-xs text-slate-500">Select a category to review only those rows, or apply its documented policy in bulk.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setActiveAnomaly('ALL');
                    document.getElementById('staged-rows-section')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold cursor-pointer ${activeAnomaly === 'ALL' ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600'}`}
                >
                  All Anomalies
                </button>
                <button
                  onClick={() => applyCategoryPolicy('ALL')}
                  disabled={busyKey === 'category-ALL'}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-300 cursor-pointer"
                  title="Apply every supported policy. Rows with manual-only anomalies are skipped."
                >
                  <Info className="h-3.5 w-3.5" />
                  Apply Supported Policies
                </button>
              </div>
            </div>

            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {report.breakdown.map((item) => {
                const isAllResolved = item.pending === 0;
                const isSelected = activeAnomaly === item.code;

                const cardClass = isSelected
                  ? 'border-indigo-400 bg-indigo-50'
                  : 'border-slate-200 bg-slate-50';

                const blurClass = isAllResolved ? 'opacity-55 filter blur-[0.4px]' : '';

                return (
                  <div
                    key={item.code}
                    className={`rounded-lg border p-4 transition-all ${cardClass} ${blurClass}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <button
                          onClick={() => {
                            setActiveAnomaly(item.code);
                            document.getElementById('staged-rows-section')?.scrollIntoView({ behavior: 'smooth' });
                          }}
                          className="text-left text-sm font-bold text-slate-900 hover:text-indigo-700"
                        >
                          {item.definition.label}
                        </button>
                        <p className="mt-1 text-xs text-slate-500">{item.definition.description}</p>
                      </div>
                      <span className="rounded bg-red-100 px-2 py-1 text-xs font-bold text-red-600 shrink-0">
                        {item.total}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
                      <span className="rounded bg-amber-100 px-2 py-1 text-amber-700">Pending {item.pending}</span>
                      <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-700">Resolved {item.resolved}</span>
                      <span className="rounded bg-slate-250 px-2 py-1 text-slate-600">Rejected {item.rejected}</span>
                    </div>

                    <div className="mt-4 flex gap-2">
                      <button
                        onClick={() => {
                          setActiveAnomaly(item.code);
                          document.getElementById('staged-rows-section')?.scrollIntoView({ behavior: 'smooth' });
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                      >
                        Manual Review
                      </button>
                      <button
                        onClick={() => applyCategoryPolicy(item.code)}
                        disabled={item.pending === 0 || !item.definition.canApplyPolicy || busyKey === `category-${item.code}`}
                        title={item.definition.canApplyPolicy ? item.definition.policy : item.definition.manualHint}
                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:bg-slate-300 cursor-pointer"
                      >
                        <Info className="h-3.5 w-3.5" />
                        Apply Policy
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {sessionId && (
          <section id="staged-rows-section" className="rounded-lg border border-slate-200 bg-white shadow-sm scroll-mt-20">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="font-bold text-slate-950">Staged Rows</h2>
                <p className="mt-1 text-xs text-slate-500">Showing {filteredRows.length} row(s). Session {sessionId.slice(0, 8)}.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  <option value="ALL">All statuses</option>
                  <option value="PENDING_APPROVAL">Pending</option>
                  <option value="APPROVED">Approved</option>
                  <option value="RESOLVED">Resolved</option>
                  <option value="REJECTED">Rejected</option>
                </select>
                <button
                  onClick={() => setIsTableModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 text-xs font-semibold shadow-sm transition-all duration-205 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                  title="View complete status grid of CSV table"
                >
                  <Table className="h-4 w-4 text-white" />
                  View CSV Status Sheet
                </button>
                <button
                  onClick={() => sessionId && fetchStaged(sessionId)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-400">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Loading staged rows...
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="p-12 text-center text-sm text-slate-400">No rows match the current filters.</div>
            ) : (
              <div className="space-y-6">
                {filteredRows.map((item, index) => {
                  const isPending = item.status === 'PENDING_APPROVAL';
                  const isEditing = editingId === item.id && editState;
                  const isEven = index % 2 === 0;
                  const bgClass = isPending
                    ? (isEven ? 'bg-white border-slate-200/80' : 'bg-slate-50/50 border-slate-200/80')
                    : 'bg-slate-100/30 border-slate-200/50';
                  return (
                    <article
                      key={item.id}
                      id={`row-${item.id}`}
                      className={`space-y-4 p-6 rounded-2xl border transition-all duration-200 hover:shadow-sm scroll-mt-24 ${bgClass}`}
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-bold text-slate-400">#{item.rawRowNumber}</span>
                            <h3 className="font-semibold text-slate-900">{item.rawData.description}</h3>
                            <StatusBadge status={item.status} />
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {item.detectedAnomalies.length === 0 ? (
                              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Clean Row</span>
                            ) : item.detectedAnomalies.map((code) => (
                              <span key={code} className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-red-600">
                                {definitions[code]?.shortLabel || code.replace(/_/g, ' ')}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => startEdit(item)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            <Edit className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          {isPending && (
                            <>
                              {item.detectedAnomalies.length > 0 && (
                                <>
                                  <button
                                    onClick={() => resolveRow(item.id, 'APPLY_POLICY')}
                                    disabled={!autoSupported(item) || busyKey === `APPLY_POLICY-${item.id}`}
                                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:bg-slate-300 cursor-pointer"
                                    title={item.detectedAnomalies.map((code) => definitions[code]?.policy).filter(Boolean).join(' ')}
                                  >
                                    <Info className="h-3.5 w-3.5" />
                                    Apply Policy
                                  </button>
                                  <button
                                    onClick={() => resolveRow(item.id, 'APPROVE')}
                                    disabled={true}
                                    title="Anomalies must be resolved first before approving"
                                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white opacity-40 cursor-not-allowed"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                    Approve
                                  </button>
                                </>
                              )}
                              {item.detectedAnomalies.length === 0 && (
                                <button
                                  onClick={() => resolveRow(item.id, 'APPROVE')}
                                  disabled={busyKey === `APPROVE-${item.id}`}
                                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:bg-slate-300 cursor-pointer"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  Approve
                                </button>
                              )}
                            </>
                          )}
                          <button
                            onClick={() => resolveRow(item.id, 'REJECT')}
                            disabled={busyKey === `REJECT-${item.id}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Reject
                          </button>
                        </div>
                      </div>

                      {isPending && item.detectedAnomalies.length > 0 && (
                        <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-4 text-xs space-y-3">
                          <div className="font-semibold text-indigo-900 mb-1 flex items-center gap-1.5">
                            <Info className="h-3.5 w-3.5 text-indigo-600" />
                            Proposed Actions & Requirements:
                          </div>
                          <ul className="space-y-3 pl-1 text-slate-600">
                            {item.detectedAnomalies.map((code) => (
                              <li key={code} className="space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-bold text-red-700">{definitions[code]?.label || code}:</span>
                                  <span className="text-slate-500 italic">({definitions[code]?.description})</span>
                                </div>
                                <div className="pl-3 border-l-2 border-indigo-100 text-indigo-900">
                                  <span className="font-semibold text-indigo-700 text-[11px] uppercase tracking-wide mr-1">Policy Action:</span>
                                  {definitions[code]?.policy || 'Apply automated normalization.'}
                                </div>
                                {code === "NAME_INCONSISTENCY" && (
                                  <div className="pl-3 mt-1.5 text-slate-600 font-medium text-[11px] bg-slate-55/40 p-2 rounded-lg border border-slate-150">
                                    <span>🔍 Original Payer: <strong>"{item.rawData.paid_by}"</strong> will normalize to <strong>"{item.resolvedData?.paidBy}"</strong>.</span>
                                    {(() => {
                                      const rawParts = (item.rawData.split_with || "").split(";").map(n => n.trim()).filter(Boolean);
                                      const resParts = item.resolvedData?.splitWith || [];
                                      const mismatches = rawParts.map((p, idx) => ({ raw: p, res: resParts[idx] })).filter(m => m.res && m.raw !== m.res);
                                      if (mismatches.length > 0) {
                                        return (
                                          <div className="mt-1 text-slate-500 font-normal">
                                            Split names normalize: {mismatches.map(m => `"${m.raw}" ➔ "${m.res}"`).join(", ")}
                                          </div>
                                        );
                                      }
                                      return null;
                                    })()}
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>

                          {isPending && (item.detectedAnomalies.includes("POTENTIAL_DUPLICATE") || item.detectedAnomalies.includes("DUPLICATE_CONFLICT")) && (
                            <div className="p-4 bg-rose-50/70 border border-rose-100 rounded-xl space-y-2 text-xs">
                              <div className="font-bold text-rose-800 flex items-center gap-1.5">
                                <AlertTriangle className="h-4 w-4 text-rose-600" />
                                Duplicate Conflict Resolution Panel:
                              </div>
                              <p className="text-slate-600 leading-relaxed text-[11px]">
                                This row conflicts with another transaction in this session. Choose whether you want to approve this row (which automatically rejects the conflicting row) or reject this row.
                              </p>
                              <div className="flex flex-wrap gap-2 pt-1">
                                <button
                                  onClick={async () => {
                                    await resolveRow(item.id, item.detectedAnomalies.includes("DUPLICATE_CONFLICT") ? "RESOLVE_EDIT" : "APPROVE");
                                    const duplicates = stagedExpenses.filter(
                                      (x) =>
                                        x.id !== item.id &&
                                        x.status === "PENDING_APPROVAL" &&
                                        x.rawData.date === item.rawData.date &&
                                        (x.rawData.description?.toLowerCase().includes(item.rawData.description?.toLowerCase() || "") ||
                                         item.rawData.description?.toLowerCase().includes(x.rawData.description?.toLowerCase() || ""))
                                    );
                                    for (const dup of duplicates) {
                                      await resolveRow(dup.id, "REJECT");
                                    }
                                  }}
                                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer transition-colors shadow-xs"
                                >
                                  Keep This Row (Reject Conflicts)
                                </button>
                                <button
                                  onClick={() => resolveRow(item.id, "REJECT")}
                                  className="bg-red-600 hover:bg-red-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer transition-colors shadow-xs"
                                >
                                  Reject This Row
                                </button>
                              </div>
                              <p className="text-[10px] text-slate-400 italic mt-1.5">
                                * Note: Rejecting a row marks its status as "Rejected", meaning its amounts and splits will be completely excluded from all ledger and dashboard calculations.
                              </p>
                            </div>
                          )}
                          {!autoSupported(item) && (
                            <div className="mt-2 rounded border border-red-200 bg-red-50 p-2.5 font-medium text-red-800 flex items-start gap-1.5">
                              <AlertTriangle className="h-3.5 w-3.5 text-red-600 mt-0.5 shrink-0" />
                              <span>This row requires manual review (e.g. choosing a payer or resolving a duplicate conflict). Direct approval is disabled. Please click <strong>Edit</strong> to correct it first.</span>
                            </div>
                          )}
                        </div>
                      )}

                      {item.detectedAnomalies.length === 0 ? (
                        <div className="text-xs">
                          <DataPanel title={item.status === 'PENDING_APPROVAL' ? "CSV Row Details (No Anomaly)" : `CSV Row Details (${statusLabels[item.status] || item.status})`} data={[
                            ['Date', item.rawData.date],
                            ['Paid by', item.rawData.paid_by || 'Missing'],
                            ['Amount', `${item.rawData.amount} ${item.rawData.currency || 'INR'}`],
                            ['Split', `${item.rawData.split_type || 'equal'} · ${item.rawData.split_with || 'None'}`],
                            ['Details', item.rawData.split_details || 'None'],
                            ['Notes', item.rawData.notes || 'None'],
                            ...(item.status !== 'PENDING_APPROVAL' ? [['Action', item.resolutionSummary || 'Approved']] as [string, string][] : []),
                          ]} />
                        </div>
                      ) : (
                        <div className="grid gap-3 text-xs md:grid-cols-2">
                          <DataPanel title="Earlier CSV Row" data={[
                            ['Date', item.rawData.date],
                            ['Paid by', item.rawData.paid_by || 'Missing'],
                            ['Amount', `${item.rawData.amount} ${item.rawData.currency || 'Missing'}`],
                            ['Split', `${item.rawData.split_type || 'Settlement'} · ${item.rawData.split_with || 'None'}`],
                            ['Details', item.rawData.split_details || 'None'],
                            ['Notes', item.rawData.notes || 'None'],
                          ]} />
                          <DataPanel
                            title="Proposed Ledger Draft (Preview)"
                            isProposed={isPending}
                            muted={!isPending && !item.resolvedData}
                            data={(() => {
                              const preview = getProposedPreview(item, memberships);
                              return [
                                ['Date', formatDateDisplay(preview.date)],
                                ['Paid by', preview.paidBy || 'Awaiting manual edit...'],
                                ['Amount', preview.exchangeRate ? `${preview.amount} ${preview.currency} (₹${Math.round(preview.amount * preview.exchangeRate).toLocaleString()})` : `${preview.amount} ${preview.currency}`],
                                ['Split', `${preview.isSettlement ? 'Settlement' : preview.splitType} · ${preview.splitWith.join(', ')}`],
                                ['Details', preview.splitDetails || 'None'],
                                ['Action', item.status === 'PENDING_APPROVAL' ? 'Awaiting reviewer approval' : (item.resolutionSummary || 'Approved')],
                              ];
                            })()}
                          />
                        </div>
                      )}

                      {isEditing && (
                        <div id={`editor-${item.id}`}>
                          <ManualEditor
                            users={users}
                            state={editState}
                            setState={setEditState}
                            toggleParticipant={toggleParticipant}
                            updateSplitValue={updateSplitValue}
                            onCancel={() => { setEditingId(null); setEditState(null); }}
                            onSubmit={() => submitEdit(item.id)}
                            busy={busyKey === `RESOLVE_EDIT-${item.id}`}
                          />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>
      {isTableModalOpen && report && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-5xl max-h-[85vh] p-6 flex flex-col shadow-2xl relative">
            <button
              onClick={() => setIsTableModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="mb-4">
              <h3 className="font-bold text-lg text-slate-950 flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                CSV Import Status Sheet
              </h3>
              <p className="text-xs text-slate-500">
                Visual matrix of all staged rows. Green rows are clean or resolved; red rows contain unresolved anomalies. Click any row to jump to it.
              </p>
            </div>

            <div className="flex-1 overflow-auto border border-slate-200 rounded-2xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4 w-12">#</th>
                    <th className="py-3 px-4 w-24">Date</th>
                    <th className="py-3 px-4">Description</th>
                    <th className="py-3 px-4 w-28">Paid By</th>
                    <th className="py-3 px-4 w-28 text-right">Amount</th>
                    <th className="py-3 px-4 w-20 text-center">Currency</th>
                    <th className="py-3 px-4">Status / Anomalies</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stagedExpenses.map((item) => {
                    const hasAnomalies = item.detectedAnomalies.length > 0;
                    const isClean = !hasAnomalies;
                    const isResolved = item.status === 'APPROVED' || item.status === 'RESOLVED';
                    const isRejected = item.status === 'REJECTED';
                    const isUnresolvedPending = item.status === 'PENDING_APPROVAL' && hasAnomalies;

                    let rowBg = '';
                    let statusLabel = '';
                    if (isRejected) {
                      rowBg = 'bg-slate-100 hover:bg-slate-200/80 text-slate-400';
                      statusLabel = 'Rejected';
                    } else if (isResolved || isClean) {
                      rowBg = 'bg-emerald-50/70 hover:bg-emerald-100/70 text-emerald-950 border-emerald-100';
                      statusLabel = isClean ? 'Clean (Auto-approved)' : (statusLabels[item.status] || item.status);
                    } else if (isUnresolvedPending) {
                      rowBg = 'bg-red-50/70 hover:bg-red-100/70 text-red-950 border-red-100';
                      statusLabel = `Pending Resolution (${item.detectedAnomalies.length} anomaly)`;
                    }

                    return (
                      <tr
                        key={item.id}
                        onClick={() => {
                          setIsTableModalOpen(false);
                          document.getElementById(`row-${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }}
                        className={`cursor-pointer transition-colors border-l-4 ${rowBg}`}
                        style={{ borderLeftColor: isRejected ? '#94a3b8' : (isResolved || isClean ? '#10b981' : '#ef4444') }}
                      >
                        <td className="py-2.5 px-4 font-mono font-bold">#{item.rawRowNumber}</td>
                        <td className="py-2.5 px-4">{item.rawData.date}</td>
                        <td className="py-2.5 px-4 font-medium">{item.rawData.description}</td>
                        <td className="py-2.5 px-4">{item.rawData.paid_by || <em className="text-red-500">Missing</em>}</td>
                        <td className="py-2.5 px-4 text-right">{item.rawData.amount}</td>
                        <td className="py-2.5 px-4 text-center">{item.rawData.currency || 'INR'}</td>
                        <td className="py-2.5 px-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/60 border border-current">
                              {statusLabel}
                            </span>
                            {isUnresolvedPending && item.detectedAnomalies.map((c) => (
                              <span key={c} className="text-[9px] px-1 bg-red-100 border border-red-200 text-red-700 rounded font-semibold">
                                {definitions[c]?.shortLabel || c}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setIsTableModalOpen(false)}
                className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-4 py-2 rounded-xl cursor-pointer"
              >
                Close Sheet
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Congratulations Modal */}
      {showCongratsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl transition-all scale-100 flex flex-col items-center text-center space-y-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle className="h-10 w-10 animate-bounce" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-bold text-slate-900">All Anomalies Resolved!</h3>
              <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                Congratulations! Every CSV row has been reviewed, normalized, and committed to the database ledger. Your group expenses are now up to date.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 pt-2 sm:flex-row sm:justify-center">
              <Link
                href={`/groups/${dashboardGroupId || 'default'}`}
                className="w-full sm:w-auto inline-flex justify-center rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-indigo-500 cursor-pointer"
              >
                Go to Roommate Dashboard
              </Link>
              <button
                type="button"
                onClick={() => setShowCongratsModal(false)}
                className="w-full sm:w-auto inline-flex justify-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Stay Here
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'slate' | 'red' | 'amber' | 'emerald' }) {
  const tones = {
    slate: 'text-slate-900 bg-slate-100',
    red: 'text-red-600 bg-red-50',
    amber: 'text-amber-600 bg-amber-50',
    emerald: 'text-emerald-600 bg-emerald-50',
  };
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-2 inline-flex rounded-lg px-3 py-1 text-2xl font-bold ${tones[tone]}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: StagedExpense['status'] }) {
  const classes = {
    PENDING_APPROVAL: 'border-amber-200 bg-amber-50 text-amber-700',
    APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    RESOLVED: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    REJECTED: 'border-slate-200 bg-slate-100 text-slate-600',
  };
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${classes[status]}`}>
      {statusLabels[status]}
    </span>
  );
}

function DataPanel({ title, data, muted = false, isProposed = false }: { title: string; data: Array<[string, string]>; muted?: boolean; isProposed?: boolean }) {
  const borderBgClass = isProposed
    ? 'border-dashed border-indigo-200 bg-indigo-50/20'
    : (muted ? 'border-slate-200 bg-slate-50 text-slate-400' : 'border-slate-200 bg-white');
  return (
    <div className={`rounded-xl border p-4 transition-all ${borderBgClass}`}>
      <h4 className={`mb-3 text-[10px] font-bold uppercase tracking-wide ${isProposed ? 'text-indigo-600 font-bold' : 'text-slate-400'}`}>{title}</h4>
      <dl className="grid gap-2">
        {data.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[92px_1fr] gap-3">
            <dt className="text-slate-400">{label}</dt>
            <dd className={`font-medium ${isProposed && !muted ? 'text-indigo-950 font-semibold' : 'text-slate-700'}`}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ManualEditor({
  users,
  state,
  setState,
  toggleParticipant,
  updateSplitValue,
  onCancel,
  onSubmit,
  busy,
}: {
  users: UserItem[];
  state: EditState;
  setState: (value: EditState | ((current: EditState | null) => EditState | null)) => void;
  toggleParticipant: (name: string) => void;
  updateSplitValue: (name: string, value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const input = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10';
  const update = (patch: Partial<EditState>) => setState((current) => current ? { ...current, ...patch } : current);
  const needsValues = !state.isSettlement && state.splitType !== 'equal';

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
      <div className="mb-4 flex items-center justify-between border-b border-indigo-100 pb-3">
        <h4 className="flex items-center gap-2 text-sm font-bold text-indigo-800">
          <Users className="h-4 w-4" />
          Manual Resolver
        </h4>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-700">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Payer
          <select value={state.paidBy} onChange={(e) => update({ paidBy: e.target.value })} className={input}>
            <option value="">Select payer</option>
            {users.map((user) => <option key={user.id} value={user.name}>{user.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Amount
          <input value={state.amount} onChange={(e) => update({ amount: e.target.value })} className={input} />
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Date
          <input type="date" value={state.date} onChange={(e) => update({ date: e.target.value })} className={input} />
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Currency
          <select value={state.currency} onChange={(e) => update({ currency: e.target.value })} className={input}>
            <option value="INR">INR</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          USD to INR Rate
          <input
            value={state.exchangeRate}
            onChange={(e) => update({ exchangeRate: e.target.value })}
            disabled={state.currency !== 'USD'}
            placeholder={state.currency === 'USD' ? 'Leave blank for latest rate' : 'INR rows use 1.0'}
            className={input}
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600">
          Split Type
          <select value={state.splitType} onChange={(e) => update({ splitType: e.target.value as EditState['splitType'] })} className={input}>
            <option value="equal">Equal</option>
            <option value="unequal">Unequal Amounts</option>
            <option value="percentage">Percentages</option>
            <option value="share">Shares</option>
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-slate-600 lg:col-span-2">
          Description
          <input value={state.description} onChange={(e) => update({ description: e.target.value })} className={input} />
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
          <input type="checkbox" checked={state.isSettlement} onChange={(e) => update({ isSettlement: e.target.checked })} />
          Record as settlement
        </label>
      </div>

      <div className="mt-4 rounded-lg border border-indigo-100 bg-white p-3">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
          {state.isSettlement ? 'Receiver' : 'Participants'}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {users.map((user) => {
            const selected = state.splitWith.includes(user.name);
            return (
              <div key={user.id} className={`rounded-lg border p-3 ${selected ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <input
                    type={state.isSettlement ? 'radio' : 'checkbox'}
                    checked={selected}
                    onChange={() => state.isSettlement ? update({ splitWith: [user.name] }) : toggleParticipant(user.name)}
                  />
                  {user.name}
                </label>
                {selected && needsValues && (
                  <input
                    value={state.splitValues[user.name] || ''}
                    onChange={(e) => updateSplitValue(user.name, e.target.value)}
                    placeholder={state.splitType === 'percentage' ? '%' : state.splitType === 'share' ? 'shares' : 'amount'}
                    className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-indigo-500"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <label className="mt-4 block space-y-1 text-xs font-semibold text-slate-600">
        Notes
        <input value={state.notes} onChange={(e) => update({ notes: e.target.value })} className={input} />
      </label>

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer">
          Cancel
        </button>
        <button onClick={onSubmit} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:bg-slate-300 cursor-pointer">
          {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Commit Resolution
        </button>
      </div>
    </div>
  );
}

function rowToResolvedData(row: RawData): ResolvedData {
  const splitWith = (row.split_with || '')
    .split(';')
    .map((item) => normalizeClientName(item))
    .filter(Boolean);
  const splitType = ['equal', 'unequal', 'percentage', 'share'].includes((row.split_type || '').toLowerCase())
    ? row.split_type.toLowerCase() as ResolvedData['splitType']
    : 'equal';
  const description = row.description || '';
  const notes = row.notes || '';
  return {
    date: normalizeDateForInput(row.date),
    description,
    paidBy: normalizeClientName(row.paid_by || ''),
    amount: Number(String(row.amount || '0').replace(/["',]/g, '')) || 0,
    currency: (row.currency || 'INR').toUpperCase(),
    splitType,
    splitWith,
    splitDetails: row.split_details || '',
    notes,
    isSettlement: !row.split_type || description.toLowerCase().includes('paid back') || description.toLowerCase().includes('deposit') || notes.toLowerCase().includes('settlement'),
  };
}

function normalizeClientName(value: string) {
  const clean = value.trim().toLowerCase();
  if (!clean) return '';
  if (clean === 'priya s' || clean === 'priyas') return 'Priya';
  if (clean === 'rohan') return 'Rohan';
  if (clean.includes('kabir')) return 'Kabir';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function normalizeDateForInput(value: string) {
  const clean = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const monthMap: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const text = clean.match(/^([A-Za-z]{3,})-(\d{1,2})$/);
  if (text) return `2026-${monthMap[text[1].toLowerCase().slice(0, 3)] || '03'}-${text[2].padStart(2, '0')}`;

  const threePart = clean.match(/^(\d{1,4})[-/](\d{1,2})[-/](\d{1,4})$/);
  if (threePart) {
    const p1 = parseInt(threePart[1], 10);
    const p2 = parseInt(threePart[2], 10);
    const p3 = parseInt(threePart[3], 10);
    let day = 1, month = 1, year = 2026;
    if (p1 > 31) {
      year = p1 < 100 ? 2000 + p1 : p1;
      month = p2;
      day = p3;
    } else {
      year = p3 < 100 ? 2000 + p3 : p3;
      month = p2;
      day = p1;
    }
    if (year < 100) year += 2000;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return clean;
}

function parseSplitValues(details: string) {
  const result: Record<string, string> = {};
  for (const part of (details || '').split(';')) {
    const match = part.trim().match(/^(.+?)\s+(-?[\d.]+)%?$/);
    if (match) result[normalizeClientName(match[1])] = match[2];
  }
  return result;
}

function buildSplitDetails(state: EditState) {
  if (state.isSettlement || state.splitType === 'equal') return '';
  const suffix = state.splitType === 'percentage' ? '%' : '';
  return state.splitWith
    .map((name) => `${name} ${state.splitValues[name] || '0'}${suffix}`)
    .join('; ');
}

function getProposedPreview(item: StagedExpense, memberships: any[]): ResolvedData {
  const raw = item.rawData;
  const anomalies = item.detectedAnomalies;

  // Start with basic resolved data or raw data fallback
  const resolved = item.resolvedData ? { ...item.resolvedData } : rowToResolvedData(raw);

  // Apply proposed policy overrides for preview
  if (anomalies.includes("MULTI_CURRENCY_USD")) {
    resolved.currency = "USD";
    resolved.exchangeRate = resolved.exchangeRate || 83.0;
  }

  if (anomalies.includes("PERCENTAGE_MATH_MISMATCH") && resolved.splitDetails) {
    const pctMap = parseSplitValues(resolved.splitDetails);
    const total = Object.values(pctMap).reduce((sum, pct) => sum + parseFloat(pct), 0);
    if (total > 0) {
      const scaled: Record<string, string> = {};
      for (const [name, pctStr] of Object.entries(pctMap)) {
        const pct = parseFloat(pctStr);
        scaled[name] = String(Math.round((pct / total) * 10000) / 100);
      }
      resolved.splitDetails = Object.entries(scaled)
        .map(([name, val]) => `${name} ${val}%`)
        .join('; ');
    }
  }

  if (anomalies.includes("SPLIT_TYPE_CONFLICT")) {
    resolved.splitType = "share";
  }

  if (anomalies.includes("TEMPORAL_MEMBERSHIP_VIOLATION")) {
    if (memberships && memberships.length > 0) {
      const parsedDate = new Date(resolved.date);
      const dateMs = parsedDate.getTime();
      resolved.splitWith = resolved.splitWith.filter((name) => {
        const userMemberships = memberships.filter((m) => m.user.name === name);
        if (userMemberships.length === 0) return true; // keep if unknown to avoid silent drops
        return userMemberships.some((m) => {
          const joined = new Date(m.joinedAt).getTime();
          const left = m.leftAt ? new Date(m.leftAt).getTime() : Infinity;
          return dateMs >= joined && dateMs <= left;
        });
      });
    } else {
      resolved.splitWith = resolved.splitWith.filter((name) => name !== "Meera");
    }
  }

  if (anomalies.includes("UNREGISTERED_MEMBER") && resolved.splitWith.includes("Dev's friend Kabir")) {
    resolved.splitWith = resolved.splitWith.map(n => n === "Dev's friend Kabir" ? "Kabir" : n);
  }

  return resolved;
}

function formatDateDisplay(value?: string) {
  if (!value) return 'Not committed';
  const numeric = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (numeric) return `${numeric[3]}-${numeric[2]}-${numeric[1]}`;
  return value;
}
