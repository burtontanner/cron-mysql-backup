const mysqldump = require('mysqldump');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const diskfree = require('diskfree');


let fsPromises = fs.promises;
let success = 0;

let setUpCron =  (options) => {
    validateOptions(options);
    attemptBackup(options);
    cron.schedule(options.cronSchedule, () => {
        attemptBackup(options);
    });
};

let attemptBackup = async (options) => {
    let timestamp = null;
    try {
        await ensureFreeDiskSpace(options.directory);
        timestamp = await backupDatabase(options.connection, options.directory);
        if(options.maxBackups) await removeOldestBackups(options.maxBackups, options.directory);
    } catch(e) {
        console.error(e);
        return sendFailureEmail(options.sendTo, options.sendFrom, options.sendFromPassword, e);
    }

    console.log('Backup Complete', new Date(timestamp), timestamp);
    if(++success % options.sendSuccessEmailAfterXBackups !== 0) return;
    sendSuccessEmail(options.sendTo, options.sendFrom, options.sendFromPassword, timestamp);
};

let removeOldestBackups = async (maxBackups, directory) => {
    await ensureDirectoryExists(directory);
    let files = await fsPromises.readdir(path.join(directory));
    files = files.sort(sortFiles);
    let count = 0;
    let now = Date.now();
    for(let i in files){
        if(++count > maxBackups){
            await fsPromises.unlink(path.join(directory, files[i]));
            console.log("Removing Backup", path.join(directory, files[i]));
        }
    }
};

let removeOldestBackup = async (directory) => {
    await ensureDirectoryExists(directory);
    let files = await fsPromises.readdir(directory);
    files = files.sort(sortFiles);
    if(files.length === 0)return false;
    let toDelete = files.pop();
    await fsPromises.unlink(path.join(directory, toDelete));
    console.log("Removing Backup", path.join(directory, toDelete));
};

let backupDatabase = async (connection, directory) => {
    let timestamp = Date.now();
    ensureDirectoryExists(directory);    
    let result = await mysqldump({
        connection,
        dumpToFile: path.join(directory, timestamp+'.sql'),
    });    
    return timestamp;
};

let ensureFreeDiskSpace = async (directory) => {
    let avgBackup = await averageBackupSizeBytes(directory);
    let free  = await freeSpaceBytes();
    console.log('free', free);
    console.log('avgBackup', avgBackup);
    if(avgBackup*8 > free){
        let fileRemoved = await removeOldestBackup();
        if(!fileRemoved)return;
        return await ensureFreeDiskSpace(directory)
    }
};

let freeSpaceBytes = ()=>{
    return new Promise((resolve, reject)=>{
        diskfree.check('/', (err,stats)=>{
            if(err) reject(err);
            resolve(stats.available);
        });
    });
};

let averageBackupSizeBytes = async (directory) => {
    await ensureDirectoryExists(directory);
    let files = await fsPromises.readdir(directory);
    let totalBytes = 0;
    let len = 0;
    for (let i in files){
        len++;
        const stats = await fsPromises.stat(path.join(directory, files[i]));
        totalBytes += stats.size;    
    }
    if(!len || !totalBytes) return 0;
    return totalBytes / len;
};

let sendSuccessEmail = async (sendTo, sendFrom, sendFromPassword, timestamp) => {
    await sendEmail(sendTo, sendFrom, sendFromPassword, "Database Backup Complete", "Your last database backup was on " + new Date(timestamp));
};

let sendFailureEmail = async (sendTo, sendFrom, sendFromPassword, e) => {
    await sendEmail(sendTo, sendFrom, sendFromPassword, "Database Backup Failed", "Here is the error message /n " +e + JSON.stringify(e));
};

let sendEmail = async (sendTo, sendFrom, sendFromPassword, subject, body)=>{
    let mailConfig = {
      service: 'gmail',
      auth: {
        user: sendFrom,
        pass: sendFromPassword
      }
    };
    
    let transporter = nodemailer.createTransport(mailConfig);
    let mailOptions = {
      from: '"cron-mysql-backup" <'+sendFrom+'>', // sender address
      to: sendTo, // list of receivers
      subject, // Subject line
      html: body
    };
    let info = await transporter.sendMail(mailOptions);
    console.log('Email Sent', info.response);
};

let validateOptions = (options) => {
    let requiredFields = ['cronSchedule', 'sendTo', 'connection', 'sendFrom', 'sendFromPassword', 'sendSuccessEmailAfter', 'directory'];
    let requiredConnectionFields = ['host', 'user', 'password', 'database'];
    let missing = validateObj(options, requiredFields);
    let missingConnection = validateObj(options.connection, requiredConnectionFields);
    let error = '';
    if(missing.length > 0){
        error = 'You need to include '+ missing.join(', ')+ ' in the options object.\n';
    }
    if(missingConnection.length > 0){
        error += 'You need to include '+ missingConnection.join(', ')+ ' in the options.connection object.\n';
    }
    if(error)throw new Error(error);
};

let validateObj = (object, required) => {
    let missing = [];
    for(let i in required){
        let opt = required[i];
        if(object[opt]) continue;
        missing.push(opt);
    }
    return missing;
};

let sortFiles = (a, b)=>{
    let aTime = parseInt(a.replace('.sql', ''));    
    let bTime = parseInt(b.replace('.sql', ''));
    return bTime - aTime;
};

let ensureDirectoryExists = async (directory) => {
    if (!fs.existsSync(directory)) {
        await fsPromises.mkdir(directory);
    }
};

module.exports = setUpCron;
