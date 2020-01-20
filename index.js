const mysqldump = require('mysqldump');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const diskfree = require('diskfree');

let fsPromises = fs.promises;

let setUpCronJobs =  (options) => {
    validateOptions(options);

    // For sanity do a single attempt on the first schedule
    attemptBackup(options, 0).catch(console.error);
    for (let i in options.schedules) {
        cron.schedule(options.schedules[i].cronSchedule, () => {
            attemptBackup(options, i).catch(console.error);
        });
    }

    if (options.sendDailyReportEmail) {
        // Daily success email
        cron.schedule("*/2 * * * *", () => {
        //cron.schedule("0 0 * * *", () => {
            sendDailyReportEmail(options);
        })
    }
};

let attemptBackup = async (options, index) => {
    try {
        await validateFreeDiskSpace(options);
        let backupStartTime = Date.now();
        let backupFileName = await backupDatabase(options.connection, options.schedules[index].directory);
        let backupDuation = Date.now() - backupStartTime;
        await removeOldestBackups(options.schedules[index].maxBackups, options.schedules[index].directory);

        console.log(`Backup Complete (${backupFileName}) - Duration: ${(backupDuation / 1000).toFixed(3)} seconds`);
        options.schedules[index].successHistory.push({ backupFileName, backupDuation, time: new Date() });
    } catch(e) {
        console.error(e);
        return sendFailureEmail(options.sendTo, options.sendFrom, options.sendFromPassword, e, options.connection.database);
    }
};

let backupList = async (directory)=>{
    await ensureDirectoryExists(directory);
    let files = await fsPromises.readdir(directory);
    return files;
};

let removeOldestBackups = async (maxBackups, directory) => {
    await ensureDirectoryExists(directory);
    let files = await fsPromises.readdir(directory);
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

let backupDatabase = async (connection, directory) => {
    await ensureDirectoryExists(directory);
    let fileName = `${Date.now()}.sql.gz`;
    let result = await mysqldump({
        connection,
        dumpToFile: path.join(directory, fileName),
        compressFile: true
    });

    return fileName;
};

let validateFreeDiskSpace = async (options) => {
    let largestBackupBytes = 0;

    for (let i in options.schedules) {
        let backupSizeBytes = await largestBackupSizeBytes(options.schedules[i].directory);
        if (backupSizeBytes > largestBackupBytes)
            largestBackupBytes = backupSizeBytes;
    }

    let free  = await freeSpaceBytes();
    let total  = await totalSpaceBytes();
    console.log(`Free space ${(free / (1024*1024*1024)).toFixed(3)} GiB`);
    console.log(`Total space ${(total / (1024*1024*1024)).toFixed(3)} GiB`);
    console.log(`Largest backup ${(largestBackupBytes / (1024*1024)).toFixed(3)} MiB`, );
    if((free / total) < 0.1) { // keep 10% free
        throw new Error("Out of disk space.")
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

let totalSpaceBytes = ()=>{
    return new Promise((resolve, reject)=>{
        diskfree.check('/', (err,stats)=>{
            if(err) reject(err);
            resolve(stats.total);
        });
    });
};

let largestBackupSizeBytes = async (directory) => {
    await ensureDirectoryExists(directory);
    let files = await fsPromises.readdir(directory);
    let largest = 0;
    for (let i in files){
        const stats = await fsPromises.stat(path.join(directory, files[i]));
        if(stats.size < largest) continue;
        largest = stats.size;
    }
    if(!largest) return 0;
    return largest;
};

let sendDailyReportEmail = async (options) => {
    let averageBackupTime = 0;
    let backupList = [];

    for (let i in options.schedules) {
        backupList = backupList.concat(options.schedules[i].successHistory);
    }

    let backupMessageHtml = `<!DOCTYPE html><html><body><style>body { color: #444; }</style><h2>The following is a report of your backup history</h2>`;
    let backupListHtml = `<table style="border-collapse:collapse; border: 1px solid #a3a3a3;"><tr style="border: 1px solid #a3a3a3;">
                            <th style="border: 1px solid #a3a3a3; padding: 5px;">Date of Backup</th><th style="border: 1px solid #a3a3a3; padding: 5px;">Duration</th>
                            <th style="border: 1px solid #a3a3a3; padding: 5px;">Backup Filename</th></tr>`;
    for (let i in backupList) {
        averageBackupTime += backupList[i].backupDuation;
        backupListHtml += `<tr style="border: 1px solid #a3a3a3; padding: 5px;">
                            <td style="border: 1px solid #a3a3a3; padding: 5px;">${backupList[i].time}</td>
                            <td style="border: 1px solid #a3a3a3; padding: 5px;">${(backupList[i].backupDuation/1000).toFixed(3)} seconds</td>
                            <td style="border: 1px solid #a3a3a3; padding: 5px;">${backupList[i].backupFileName}</td></tr>`;
    }
    backupListHtml += `</table>`;
    backupMessageHtml += `<p>Average Backup Time: ${(averageBackupTime/(backupList.length*1000)).toFixed(3)} seconds</p><p>Total Backup Count: ${backupList.length}</p>`;
    backupMessageHtml += backupListHtml;
    backupMessageHtml += `</body></html>`;
    await sendEmail(options.sendTo, options.sendFrom, options.sendFromPassword, `${options.connection.database} - Backup Complete`, backupMessageHtml);
};

let sendSuccessEmail = async (sendTo, sendFrom, sendFromPassword, backupFileName, directory, database) => {
    let backups = await backupList(directory);
    await sendEmail(sendTo, sendFrom, sendFromPassword, `${database} - Backup Complete`, `Your last database backup was on ${new Date()} with filename: ${backupFileName}.<br> You have ${backups.length} backups.<br> ${backups.join('<br>')}`);
};

let sendFailureEmail = async (sendTo, sendFrom, sendFromPassword, e, database) => {
    await sendEmail(sendTo, sendFrom, sendFromPassword, database + " Backup Failed", "Here is the error message <br> " +e + JSON.stringify(e));
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
    let requiredFields = ['schedules', 'sendTo', 'connection', 'sendFrom', 'sendFromPassword', 'sendDailyReportEmail'];
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
    if(options.schedules.length == 0) {
        error += 'You did not specify any cron schedules.\n';
    } else {
        let requiredScheduleFields = ['cronSchedule', 'directory', 'maxBackups'];
        let missingScheduleFields = [];
        for (let i in options.schedules) {
            options.schedules[i].successHistory = [];
            missingScheduleFields = missingScheduleFields.concat(validateObj(options.schedules[i], requiredScheduleFields));
        }
        if(missingScheduleFields.length > 0){
            error += 'You need to include '+ missingScheduleFields.join(', ')+ ' in the options.schedules object.\n';
        }
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

module.exports = setUpCronJobs;
