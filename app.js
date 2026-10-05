const STORAGE_KEY = 'rcpit_student_cards';
let adminCards = [];

const fields = {
  studentName: document.getElementById('studentName'),
  studentRoll: document.getElementById('studentRoll'),
  studentCourse: document.getElementById('studentCourse'),
  studentDepartment: document.getElementById('studentDepartment'),
  studentSemester: document.getElementById('studentSemester'),
  studentEmail: document.getElementById('studentEmail'),
  studentPhone: document.getElementById('studentPhone'),
  studentBlood: document.getElementById('studentBlood'),
  studentDob: document.getElementById('studentDob'),
  studentAbcId: document.getElementById('studentAbcId'),
  studentAddress: document.getElementById('studentAddress'),
  studentPhoto: document.getElementById('studentPhoto')
};

const preview = {
  name: document.getElementById('previewName'),
  department: document.getElementById('previewDepartment'),
  semester: document.getElementById('previewSemester'),
  email: document.getElementById('previewEmail'),
  photoCircle: document.getElementById('photoCircle'),
  photoPreview: document.getElementById('photoPreview'),
  qrPreview: document.getElementById('qrPreview'),
  qrLabel: document.getElementById('qrLabel'),
  backName: document.getElementById('backName'),
  backDob: document.getElementById('backDob'),
  backAbcId: document.getElementById('backAbcId'),
  backAddress: document.getElementById('backAddress')
};

const defaultValues = {
  studentName: 'Aarav Patel',
  studentRoll: '123',
  studentCourse: 'B.E. Computer Science',
  studentDepartment: 'Computer Engineering',
  studentSemester: '123456789',
  studentEmail: 'aarav.patel@rcpit.edu.in',
  studentPhone: '+91 98765 43210',
  studentBlood: 'O+',
  studentDob: '2005-05-15',
  studentAbcId: 'ABC123456789',
  studentAddress: 'Nashik, Maharashtra'
};

const selectDefaults = {
  studentDepartment: 'Computer Engineering',
  studentBlood: 'O+'
};

const safeText = (value, fallback) => value.trim() || fallback;
const formatPRN = (value) => value.replace(/\D/g, '').slice(0, 9);
const formatRollNo = (value) => value.replace(/\D/g, '').slice(0, 3);

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function getInitials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'RP';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

let photoLoadPromise = Promise.resolve(true);

function loadPhotoPreview(file) {
  if (!file) {
    preview.photoPreview.src = '';
    preview.photoPreview.classList.add('hidden-image');
    preview.photoCircle.style.display = 'grid';
    return Promise.resolve(true);
  }
  if (!file.type.startsWith('image/')) {
    alert('Please choose an image file for the student photo.');
    fields.studentPhoto.value = '';
    return Promise.resolve(false);
  }

  preview.photoCircle.style.display = 'none';
  return readFileAsDataURL(file)
    .then((dataUrl) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try {
          const scale = Math.min(1, 480 / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext('2d');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new Error('Could not decode image'));
      image.src = dataUrl;
    }))
    .then((dataUrl) => {
      preview.photoPreview.src = dataUrl;
      preview.photoPreview.classList.remove('hidden-image');
      return true;
    })
    .catch(() => {
      preview.photoCircle.style.display = 'grid';
      alert('Image could not be loaded. Please select a JPG or PNG image.');
      return false;
    });
}

function generateQrDataUrl(studentInfo) {
  if (typeof QRCode === 'undefined') throw new Error('QR code generator is unavailable');
  const qrContainer = document.createElement('div');
  const qrText = studentInfo.verificationStatus === 'VERIFIED'
    ? [
      'RC Patel Institute of Technology',
      'ID CARD STATUS: VERIFIED',
      `Name: ${studentInfo.name || ''}`,
      `PRN: ${studentInfo.prn || ''}`,
      `Department: ${studentInfo.branch || ''}`,
      `Roll No: ${studentInfo.rollNo || ''}`
    ].join('\n')
    : JSON.stringify(studentInfo);
  new QRCode(qrContainer, {
    text: qrText, width: 256, height: 256,
    correctLevel: QRCode.CorrectLevel.M
  });
  const canvas = qrContainer.querySelector('canvas');
  if (!canvas) throw new Error('QR code could not be generated');
  return canvas.toDataURL('image/png');
}

function getQrStudentInfo() {
  return {
    name: fields.studentName.value.trim(),
    rollNo: formatRollNo(fields.studentRoll.value),
    course: fields.studentCourse.value.trim(),
    branch: fields.studentDepartment.value,
    prn: formatPRN(fields.studentSemester.value),
    email: fields.studentEmail.value.trim(),
    phone: fields.studentPhone.value.trim(),
    bloodGroup: fields.studentBlood.value,
    dateOfBirth: fields.studentDob.value,
    abcId: fields.studentAbcId.value.trim(),
    address: fields.studentAddress.value.trim()
  };
}

function updateCard() {
  const name = safeText(fields.studentName.value, 'Student Name');
  const department = safeText(fields.studentDepartment.value, '---');
  const prn = formatPRN(fields.studentSemester.value);
  fields.studentSemester.value = prn;
  preview.name.textContent = name;
  preview.department.textContent = department;
  preview.semester.textContent = prn.length === 9 ? prn : '---';
  preview.email.textContent = safeText(fields.studentEmail.value, '---');
  preview.photoCircle.textContent = getInitials(name);
  preview.backName.textContent = name;
  preview.backDob.textContent = fields.studentDob.value
    ? new Date(`${fields.studentDob.value}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '---';
  preview.backAbcId.textContent = safeText(fields.studentAbcId.value, '---');
  preview.backAddress.textContent = fields.studentAddress.value.trim() || 'Address not provided';
  try {
    preview.qrPreview.src = generateQrDataUrl(getQrStudentInfo());
    preview.qrPreview.classList.remove('hidden-image');
    preview.qrLabel.style.display = 'none';
  } catch (error) {
    preview.qrPreview.src = '';
    preview.qrPreview.classList.add('hidden-image');
    preview.qrLabel.style.display = 'block';
  }
}

function seedDemoData() {
  Object.entries(defaultValues).forEach(([key, value]) => {
    if (fields[key]) fields[key].value = value;
  });
  Object.entries(selectDefaults).forEach(([key, value]) => {
    if (fields[key]) fields[key].value = value;
  });
  updateCard();
}

function resetForm() {
  Object.values(fields).forEach((field) => {
    if (field) field.value = '';
  });
  photoLoadPromise = Promise.resolve(true);
  preview.photoPreview.src = '';
  preview.photoPreview.classList.add('hidden-image');
  preview.photoCircle.style.display = 'grid';
  preview.photoCircle.textContent = 'RP';
  updateCard();
}

function getStudentPayload() {
  return {
    id: Date.now(),
    name: fields.studentName.value.trim(),
    rollNo: formatRollNo(fields.studentRoll.value),
    course: fields.studentCourse.value.trim(),
    department: fields.studentDepartment.value,
    prn: formatPRN(fields.studentSemester.value),
    email: fields.studentEmail.value.trim(),
    phone: fields.studentPhone.value.trim(),
    bloodGroup: fields.studentBlood.value,
    dob: fields.studentDob.value,
    abcId: fields.studentAbcId.value.trim(),
    address: fields.studentAddress.value.trim(),
    photoDataUrl: preview.photoPreview.classList.contains('hidden-image') ? '' : preview.photoPreview.src,
    qrDataUrl: '',
    status: 'Pending',
    signedBy: '',
    createdAt: new Date().toISOString()
  };
}

async function saveStudentCard() {
  if (!(await photoLoadPromise)) return;
  const payload = getStudentPayload();
  if (!payload.name || !payload.rollNo || !payload.course || !payload.department || payload.prn.length !== 9) {
    alert('Please enter Name, a maximum 3-digit Roll Number, Course, Department, and a 9-digit PRN.');
    return;
  }
  try {
    payload.qrDataUrl = generateQrDataUrl(getQrStudentInfo());
    await apiRequest('/api/cards', { method: 'POST', body: JSON.stringify(payload) });
  } catch (error) {
    alert(`Could not save the ID card: ${error.message}. Start the app with python server.py and try again.`);
    return;
  }
  try {
    const cards = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    cards.push(payload);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  } catch (error) {
    console.warn('Local card cache could not be updated.', error);
  }
  alert('Student ID card saved successfully and sent for verification.');
}

async function importLocalCards() {
  let cards = [];
  try {
    cards = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch (error) {
    return;
  }
  if (Array.isArray(cards) && cards.length) {
    await apiRequest('/api/admin/cards/import', { method: 'POST', body: JSON.stringify(cards) });
  }
}

async function renderAdminList() {
  const studentList = document.getElementById('studentList');
  try {
    const { cards } = await apiRequest('/api/admin/cards');
    adminCards = cards;
    renderFilteredAdminList();
  } catch (error) {
    studentList.innerHTML = `<div class="student-card"><p>${escapeHtml(error.message)}</p></div>`;
    document.getElementById('adminResultCount').textContent = '';
  }
}

function getFilteredAdminCards() {
  const query = document.getElementById('adminSearch').value.trim().toLowerCase();
  const status = document.getElementById('adminStatusFilter').value;
  return adminCards.filter((card) => {
    const matchesStatus = status === 'all' || card.status === status;
    const searchable = [card.name, card.rollNo, card.prn, card.department, card.course, card.email, card.status]
      .join(' ').toLowerCase();
    return matchesStatus && (!query || searchable.includes(query));
  });
}

function renderFilteredAdminList() {
  const studentList = document.getElementById('studentList');
  const cards = getFilteredAdminCards();
  document.getElementById('adminResultCount').textContent = `${cards.length} of ${adminCards.length} cards`;
  if (!cards.length) {
    studentList.innerHTML = `<div class="student-card"><p>${adminCards.length ? 'No cards match these filters.' : 'No student records found yet.'}</p></div>`;
    return;
  }

  studentList.innerHTML = cards.map((card) => {
    const statusClass = card.status === 'Verified' ? 'verified' : card.status === 'Blocked' ? 'blocked' : 'pending';
    const actions = card.status === 'Pending'
      ? `<button class="verify-btn" data-id="${escapeHtml(card.id)}">Verify & Sign</button>`
      : '';
    return `
      <div class="student-card">
        <span class="status-badge ${statusClass}">${escapeHtml(card.status)}</span>
        <h4>${escapeHtml(card.name)}</h4>
        <p><strong>Roll:</strong> ${escapeHtml(card.rollNo || '---')}</p>
        <p><strong>PRN:</strong> ${escapeHtml(card.prn || '---')}</p>
        <p><strong>Department:</strong> ${escapeHtml(card.department || '---')}</p>
        <p><strong>Email:</strong> ${escapeHtml(card.email || '---')}</p>
        <p><strong>Signed By:</strong> ${escapeHtml(card.signedBy || 'Not signed yet')}</p>
        ${actions ? `<div class="student-card-actions">${actions}</div>` : ''}
      </div>
    `;
  }).join('');
  studentList.querySelectorAll('.verify-btn').forEach((button) => {
    button.addEventListener('click', () => verifyStudent(button.dataset.id));
  });
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\t\r=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportAdminCsv() {
  const cards = getFilteredAdminCards();
  if (!cards.length) {
    alert('There are no matching student cards to export.');
    return;
  }

  const columns = [
    ['name', 'Name'], ['rollNo', 'Roll Number'], ['prn', 'PRN'], ['course', 'Course'],
    ['department', 'Department'], ['email', 'Email'], ['phone', 'Phone'],
    ['bloodGroup', 'Blood Group'], ['dob', 'Date of Birth'], ['abcId', 'ABC ID'],
    ['address', 'Address'], ['status', 'Status'], ['signedBy', 'Signed By'],
    ['createdAt', 'Submitted At'], ['signedAt', 'Verified At']
  ];
  const rows = [
    columns.map(([, label]) => csvCell(label)).join(','),
    ...cards.map((card) => columns.map(([key]) => csvCell(card[key])).join(','))
  ];
  const blob = new Blob([`\uFEFF${rows.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `student-id-cards-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function updateAdminCardStatus(studentId, action) {
  const { card } = await apiRequest(`/api/admin/cards/${encodeURIComponent(studentId)}/${action}`, {
    method: 'POST', body: '{}'
  });
  const cards = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards.map((item) => (
    String(item.id) === String(studentId) ? card : item
  ))));
  await renderAdminList();
}

async function verifyStudent(studentId) {
  try {
    await updateAdminCardStatus(studentId, 'verify');
    alert('Student ID card verified and signed successfully.');
  } catch (error) {
    alert(error.message);
  }
}

function renderVerifiedCard(card) {
  const container = document.getElementById('verifiedCardSides');
  const front = document.getElementById('idCard').cloneNode(true);
  const back = document.getElementById('idCardBack').cloneNode(true);
  front.querySelector('#previewName').textContent = card.name || 'Student Name';
  front.querySelector('#previewSemester').textContent = card.prn || '---';
  front.querySelector('#previewDepartment').textContent = card.department || '---';
  front.querySelector('#previewEmail').textContent = card.email || '---';
  if (card.directorSignatureDataUrl) {
    const signature = front.querySelector('.director-signature-image');
    signature.src = card.directorSignatureDataUrl;
    signature.classList.remove('hidden-image');
  }
  const photo = front.querySelector('#photoPreview');
  const initials = front.querySelector('#photoCircle');
  if (card.photoDataUrl) {
    photo.src = card.photoDataUrl;
    photo.classList.remove('hidden-image');
    initials.style.display = 'none';
  } else {
    initials.textContent = getInitials(card.name || '');
  }
  back.querySelector('#backName').textContent = card.name || 'Student Name';
  back.querySelector('#backDob').textContent = card.dob
    ? new Date(`${card.dob}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '---';
  back.querySelector('#backAbcId').textContent = card.abcId || '---';
  back.querySelector('#backAddress').textContent = card.address || 'Address not provided';
  const qr = back.querySelector('#qrPreview');
  qr.src = generateQrDataUrl({
    name: card.name, rollNo: card.rollNo, course: card.course, branch: card.department,
    prn: card.prn, email: card.email, phone: card.phone, bloodGroup: card.bloodGroup,
    dateOfBirth: card.dob, abcId: card.abcId, address: card.address,
    verificationStatus: card.status === 'Verified' ? 'VERIFIED' : ''
  });
  qr.classList.remove('hidden-image');
  back.querySelector('#qrLabel').style.display = 'none';
  [front, back].forEach((cardElement) => {
    cardElement.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
  });
  container.replaceChildren(front, back);
  document.getElementById('verifiedCardStudentName').textContent = card.name || 'Verified Student';
}

async function loginStudentCard() {
  const name = document.getElementById('verifiedStudentName').value.trim();
  const prn = document.getElementById('verifiedPrn').value.trim();
  const message = document.getElementById('studentLoginMessage');
  message.textContent = '';
  try {
    const { card } = await apiRequest('/api/student/login', {
      method: 'POST', body: JSON.stringify({ name, prn })
    });
    renderVerifiedCard(card);
    document.getElementById('studentLoginBox').classList.add('hidden');
    document.getElementById('studentCardResult').classList.remove('hidden');
  } catch (error) {
    message.textContent = error.message;
  }
}

async function restoreStudentSession() {
  try {
    const { card } = await apiRequest('/api/student/card');
    renderVerifiedCard(card);
    document.getElementById('studentLoginBox').classList.add('hidden');
    document.getElementById('studentCardResult').classList.remove('hidden');
  } catch (error) {
    document.getElementById('studentLoginBox').classList.remove('hidden');
    document.getElementById('studentCardResult').classList.add('hidden');
  }
}

async function logoutStudentCard() {
  try {
    await apiRequest('/api/student/logout', { method: 'POST', body: '{}' });
  } catch (error) {
    console.warn('Student session could not be cleared on the server.', error);
  }
  document.getElementById('verifiedStudentName').value = '';
  document.getElementById('verifiedPrn').value = '';
  document.getElementById('studentLoginBox').classList.remove('hidden');
  document.getElementById('studentCardResult').classList.add('hidden');
  document.getElementById('verifiedCardSides').replaceChildren();
}

async function downloadVerifiedCard() {
  try {
    const canvas = await html2canvas(document.getElementById('verifiedCardPrintArea'), {
      backgroundColor: '#ffffff', scale: 3
    });
    const imageBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG export failed')), 'image/png');
    });
    const imageUrl = URL.createObjectURL(imageBlob);
    const link = document.createElement('a');
    const studentName = document.getElementById('verifiedCardStudentName').textContent
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'student';
    link.download = `${studentName}-id-card.png`;
    link.href = imageUrl;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(imageUrl), 1000);
  } catch (error) {
    alert('Could not download the card image. Please use Print Card and choose Save as PDF.');
  }
}

function printVerifiedCard() {
  document.body.classList.add('verified-print-mode');
  window.addEventListener('afterprint', () => document.body.classList.remove('verified-print-mode'), { once: true });
  window.print();
}

function showPortal(targetId) {
  document.querySelectorAll('.portal-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === targetId);
    panel.classList.toggle('hidden', panel.id !== targetId);
  });
  document.querySelectorAll('.tab-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.target === targetId);
  });
  closePortalMenu();
  if (targetId === 'adminPortal' && !document.getElementById('adminDashboard').classList.contains('hidden')) {
    renderAdminList();
  }
  if (targetId === 'verifiedCardPortal') restoreStudentSession();
}

function closePortalMenu() {
  const toggle = document.getElementById('menuToggle');
  const navigation = document.getElementById('portalNavigation');
  navigation.classList.add('hidden');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open portal menu');
}

async function loginAdmin() {
  const username = document.getElementById('adminUsername').value.trim();
  const password = document.getElementById('adminPassword').value.trim();
  try {
    await apiRequest('/api/admin/login', {
      method: 'POST', body: JSON.stringify({ username, password })
    });
    await importLocalCards();
    document.getElementById('adminLoginBox').classList.add('hidden');
    document.getElementById('adminDashboard').classList.remove('hidden');
    await loadDirectorSignature();
    await renderAdminList();
  } catch (error) {
    alert(error.message);
  }
}

async function logoutAdmin() {
  try {
    await apiRequest('/api/admin/logout', { method: 'POST', body: '{}' });
  } catch (error) {
    console.warn('Admin session could not be cleared on the server.', error);
  }
  document.getElementById('adminUsername').value = '';
  document.getElementById('adminPassword').value = '';
  document.getElementById('adminDashboard').classList.add('hidden');
  document.getElementById('adminLoginBox').classList.remove('hidden');
}

async function prepareDirectorSignature(file) {
  if (!file) return '';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a PNG, JPG, or WebP image.');
  }
  const dataUrl = await readFileAsDataURL(file);
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('Signature image could not be opened.'));
    image.src = dataUrl;
  });
  const scale = Math.min(1, 1000 / image.naturalWidth, 400 / image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

async function loadDirectorSignature() {
  const { signatureDataUrl } = await apiRequest('/api/admin/signature');
  const previewImage = document.getElementById('directorSignaturePreview');
  const status = document.getElementById('signatureStatus');
  if (signatureDataUrl) {
    previewImage.src = signatureDataUrl;
    previewImage.classList.remove('hidden-image');
    status.textContent = 'A director signature is stored for future verifications.';
  } else {
    previewImage.src = '';
    previewImage.classList.add('hidden-image');
    status.textContent = 'No signature stored yet.';
  }
}

async function saveDirectorSignature() {
  const fileInput = document.getElementById('directorSignatureFile');
  const status = document.getElementById('signatureStatus');
  const file = fileInput.files?.[0];
  if (!file) {
    status.textContent = 'Choose a signature image first.';
    return;
  }
  status.textContent = 'Saving signature...';
  try {
    const signatureDataUrl = await prepareDirectorSignature(file);
    await apiRequest('/api/admin/signature', {
      method: 'POST', body: JSON.stringify({ signatureDataUrl })
    });
    await loadDirectorSignature();
    fileInput.value = '';
  } catch (error) {
    status.textContent = error.message;
  }
}

document.getElementById('generateBtn').addEventListener('click', updateCard);
document.getElementById('saveBtn').addEventListener('click', saveStudentCard);
document.getElementById('resetBtn').addEventListener('click', resetForm);
document.getElementById('adminLoginBtn').addEventListener('click', loginAdmin);
document.getElementById('logoutAdminBtn').addEventListener('click', logoutAdmin);
document.getElementById('saveDirectorSignatureBtn').addEventListener('click', saveDirectorSignature);
document.getElementById('exportAdminCsvBtn').addEventListener('click', exportAdminCsv);
document.getElementById('adminSearch').addEventListener('input', renderFilteredAdminList);
document.getElementById('adminStatusFilter').addEventListener('change', renderFilteredAdminList);
document.getElementById('studentCardLoginBtn').addEventListener('click', loginStudentCard);
document.getElementById('studentCardLogoutBtn').addEventListener('click', logoutStudentCard);
document.getElementById('downloadCardBtn').addEventListener('click', downloadVerifiedCard);
document.getElementById('printCardBtn').addEventListener('click', printVerifiedCard);

document.querySelectorAll('.tab-btn').forEach((button) => {
  button.addEventListener('click', () => showPortal(button.dataset.target));
});

document.getElementById('menuToggle').addEventListener('click', () => {
  const toggle = document.getElementById('menuToggle');
  const navigation = document.getElementById('portalNavigation');
  const isOpen = !navigation.classList.contains('hidden');
  navigation.classList.toggle('hidden', isOpen);
  toggle.setAttribute('aria-expanded', String(!isOpen));
  toggle.setAttribute('aria-label', isOpen ? 'Open portal menu' : 'Close portal menu');
});

document.addEventListener('click', (event) => {
  const menu = document.querySelector('.portal-menu');
  if (!menu.contains(event.target)) closePortalMenu();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePortalMenu();
});

window.addEventListener('focus', () => {
  if (document.visibilityState === 'visible' &&
      document.getElementById('adminPortal').classList.contains('active') &&
      !document.getElementById('adminDashboard').classList.contains('hidden')) {
    renderAdminList();
  }
});

window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY &&
      document.getElementById('adminPortal').classList.contains('active') &&
      !document.getElementById('adminDashboard').classList.contains('hidden')) {
    renderAdminList();
  }
});

fields.studentPhoto.addEventListener('change', () => {
  photoLoadPromise = loadPhotoPreview(fields.studentPhoto.files?.[0]);
});

Object.values(fields).forEach((field) => {
  if (!field || field.id === 'studentPhoto') return;
  field.addEventListener('input', updateCard);
  field.addEventListener('change', updateCard);
});

seedDemoData();
showPortal('studentPortal');
