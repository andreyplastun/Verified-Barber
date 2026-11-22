import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Review} from '../shared/schema';
import {isPublishedReview} from '../shared/review-visibility';
import {maskReviewsForViewer} from './review-response';
const row={id:11,clientId:'fixture-author',bookingId:19,customerName:'Fixture',showName:false,publishReview:true,isFinalized:true,editableUntil:new Date(),normalizedText:'internal',isPrivate:false} as Review;
for(const role of [null,'client','specialist'] as const)test(`public review reaches both public page filters (${role}) without client data`,()=>{
 const rows=maskReviewsForViewer([row,{...row,isPrivate:true},{...row,publishReview:false},{...row,isFinalized:false}],role,'other-viewer');
 assert.equal(rows.length,1);assert.deepEqual(rows.filter(isPublishedReview).map(r=>r.id),[11]);assert.equal(rows[0].customerName,'Аноним');for(const key of ['bookingId','clientId','editableUntil','normalizedText'])assert.equal(key in rows[0],false);
});
test('only author can locate their editable non-final review',()=>{
 const own={...row,isFinalized:false};const [item]=maskReviewsForViewer([own],'client',row.clientId!);assert.equal('bookingId' in item && item.bookingId,19);assert.equal('editableUntil' in item && item.editableUntil,row.editableUntil);assert.equal(isPublishedReview(item),false);assert.equal(maskReviewsForViewer([own],'client','other').length,0);
});
